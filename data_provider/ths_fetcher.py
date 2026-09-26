# -*- coding: utf-8 -*-
"""同花顺 Financial-API 数据源（ThsFetcher）。

对接同花顺官方开放 API（HiThink Financial-API，https://fuyao.aicubes.cn），
作为 A 股行情与市场情绪数据的第二个独立商业源：

- 历史日 K（``/api/a-share/prices/historical``）：前复权，pct_chg 由相邻收盘价推导
- 涨停池 / 跌停池 / 炸板池（``/api/a-share/special-data/*``）：与 akshare(东财) 口径交叉验证
- 代码/名称消歧（``/api/meta/tickers/search``）：快照补名的辅助通道

配置：
- ``HITHINK_FINANCE_API_KEY``：商业 API key，留空 = 整个 fetcher 不可用（零影响）
- ``HITHINK_FINANCE_API_URL``：接入地址覆盖（默认官方地址，仅测试/代理场景）
- ``HITHINK_FINANCE_PRIORITY``：未 boost 时的优先级（默认 99 垫底；配置 key 后 boost 到 2）

仅支持 A 股；港美股/分钟线/tick 不支持，入参前置拒绝。
"""

import json
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

import pandas as pd
import requests
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log,
)

from .base import (
    BaseFetcher,
    DataFetchError,
    RateLimitError,
    STANDARD_COLUMNS,
    _is_hk_market,
    _is_jp_market,
    _is_kr_market,
    _is_tw_market,
    _is_us_market,
    is_bse_code,
    normalize_stock_code,
)
from src.config import get_config

logger = logging.getLogger(__name__)

_DEFAULT_BASE_URL = "https://fuyao.aicubes.cn"
_THS_TZ = ZoneInfo("Asia/Shanghai")

# 历史 K 线窗口上限（官方限制单次窗口 ≤10 年）
_MAX_HISTORY_YEARS = 10
_MAX_HISTORY_DAYS = _MAX_HISTORY_YEARS * 365
# 历史日 K 分页大小与防御性翻页上限
_HISTORY_PAGE_SIZE = 500
_HISTORY_MAX_PAGES = 40
# 池类接口单页上限（官方 ≤200）
_MAX_POOL_PAGE_SIZE = 200

# THS 响应信封错误码 → 项目异常语义（见 redesign/features/data-source/design.md §2.2）
_THS_RATE_LIMIT_CODE = 4001
_THS_AUTH_CODES = {2001, 2003}
_THS_NO_DATA_CODES = {3001, 3002, 3004}


class _ThsAuthError(DataFetchError):
    """THS 认证失败（code 2001/2003）：key 失效或无权限，调用方应长冷却。"""


def _resolve_ths_base_url() -> Optional[str]:
    """读取 ``HITHINK_FINANCE_API_URL`` 环境变量并做基本校验。

    - 留空 / 仅空白 / 未设置 → 返回 ``None``，调用方走官方默认地址。
    - 设置则去掉首尾空白后返回，并校验必须以 ``http://`` / ``https://`` 开头，
      避免误填纯主机名导致 requests 按相对路径请求失败。
    """
    raw = os.getenv("HITHINK_FINANCE_API_URL")
    if not raw:
        return None
    url = raw.strip()
    if not url:
        return None
    if not (url.startswith("http://") or url.startswith("https://")):
        raise ValueError(
            "HITHINK_FINANCE_API_URL 必须以 http:// 或 https:// 开头，"
            f"当前值为 {url!r}"
        )
    return url


class _ThsHttpClient:
    """同花顺 Financial-API 轻量客户端：SDK-free，requests 直连。

    响应信封：``{"code": 0, "message": "ok", "data": {"item": [...]}}``。
    所有业务错误均返回 HTTP 200，靠 ``code`` 字段区分。
    """

    def __init__(self, api_key: str, base_url: str = _DEFAULT_BASE_URL, timeout: int = 30) -> None:
        self._api_key = (api_key or "").strip()
        self._base_url = (base_url or _DEFAULT_BASE_URL).rstrip("/")
        self._timeout = timeout

    def request(self, path: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        res = requests.get(
            self._base_url + path,
            params=params or {},
            headers={"X-api-key": self._api_key},
            timeout=self._timeout,
        )
        if res.status_code != 200:
            raise DataFetchError(f"THS API HTTP {res.status_code}")

        try:
            body = json.loads(res.text)
        except ValueError as e:
            raise DataFetchError(f"THS API 响应非 JSON: {e}") from e

        code = body.get("code")
        message = str(body.get("message") or "")
        if code == 0:
            data = body.get("data") or {}
            items = data.get("item")
            return items if isinstance(items, list) else []
        if code == _THS_RATE_LIMIT_CODE:
            raise RateLimitError(f"THS QPS 超限: {message}")
        if code in _THS_AUTH_CODES:
            raise _ThsAuthError(f"THS 认证失败(code={code}): {message}")
        if code in _THS_NO_DATA_CODES:
            # 未找到/未就绪/不支持 = 无数据，返回空列表，不抛错
            return []
        raise DataFetchError(f"THS API 错误 code={code}: {message}")


class ThsFetcher(BaseFetcher):
    """同花顺 Financial-API 数据源（仅 A 股）。

    关键策略：
    - 未配置 key 时不实例化（Manager gating），已实例化但 key 失效时 ``is_available()`` 转False
    - 认证失败（2001/2003）置进程内长冷却，避免每轮分析都撞认证失败
    - QPS 超限（4001）抛 ``RateLimitError``，走 Manager 现有熔断冷却
    - 定位为第二源/fallback：配置 key 后 boost 到 Tushare 相邻档位，不与免费主源竞争
    """

    name = "ThsFetcher"
    priority = int(os.getenv("HITHINK_FINANCE_PRIORITY", "99"))

    def __init__(self) -> None:
        self._client: Optional[_ThsHttpClient] = None
        self._auth_failed = False
        self._init_client()
        self.priority = self._determine_priority()

    # ============================================================
    # 初始化与可用性
    # ============================================================

    def _init_client(self) -> None:
        config = get_config()
        api_key = (getattr(config, "hithink_finance_api_key", None) or "").strip()
        if not api_key:
            logger.info("HITHINK_FINANCE_API_KEY 未配置，ThsFetcher 不可用")
            return
        try:
            base_url = _resolve_ths_base_url()
        except ValueError as e:
            logger.error("%s，ThsFetcher 不可用", e)
            return
        if not base_url:
            base_url = (getattr(config, "hithink_finance_api_url", None) or "").strip() or _DEFAULT_BASE_URL
        self._client = _ThsHttpClient(api_key=api_key, base_url=base_url)
        logger.info("THS Financial-API 客户端初始化成功: %s", base_url)

    def _determine_priority(self) -> int:
        """配置 key 且客户端就绪 → boost 到 Tushare 相邻档位（2）；否则保持类默认（99 垫底）。"""
        if self._client is not None:
            logger.info("✅ 检测到 HITHINK_FINANCE_API_KEY，ThsFetcher 优先级提升为 %d", 2)
            return 2
        return ThsFetcher.priority

    def is_available(self) -> bool:
        """Manager 探针兼容的方法风格（镜像 Tushare）。key 未配置或认证失效 → False。"""
        return self._client is not None and not self._auth_failed

    # ============================================================
    # 代码转换
    # ============================================================

    @staticmethod
    def _ensure_cn_stock(stock_code: str) -> None:
        """仅支持 A 股，其它市场入参前置拒绝（不打 HTTP）。"""
        if (
            _is_hk_market(stock_code)
            or _is_us_market(stock_code)
            or _is_jp_market(stock_code)
            or _is_kr_market(stock_code)
            or _is_tw_market(stock_code)
        ):
            raise DataFetchError(f"ThsFetcher 仅支持 A 股，不支持 {stock_code}")

    @staticmethod
    def _to_ths_code(stock_code: str) -> str:
        """内部裸代码 → 同花顺带交易所后缀代码（``600519`` → ``600519.SH``）。"""
        code = normalize_stock_code(stock_code)
        if len(code) == 6 and code.isdigit():
            if is_bse_code(code):
                return f"{code}.BJ"
            if code.startswith(("5", "6", "9")):
                # 沪市：股票 6xxxxx / 基金 5xxxxx / B 股 9xxxxx
                return f"{code}.SH"
            return f"{code}.SZ"
        raise DataFetchError(f"ThsFetcher 无法识别 A 股代码: {stock_code}")

    # ============================================================
    # 统一请求与错误映射
    # ============================================================

    def _request_items(self, path: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        """客户端调用 + 认证失效标记。网络层异常原样抛出（tenacity 按类型重试）。"""
        assert self._client is not None
        try:
            return self._client.request(path, params)
        except _ThsAuthError as e:
            self._auth_failed = True
            logger.error("THS 认证失败，ThsFetcher 本进程内停用: %s", e)
            raise DataFetchError(str(e)) from e

    # ============================================================
    # 历史 K 线（P0）
    # ============================================================

    @staticmethod
    def _parse_trade_date(date_str: str, *, end_of_day: bool) -> datetime:
        text = (date_str or "").strip().replace("/", "-")
        dt = None
        for fmt in ("%Y-%m-%d", "%Y%m%d"):
            try:
                dt = datetime.strptime(text, fmt)
                break
            except ValueError:
                continue
        if dt is None:
            raise DataFetchError(f"THS 无法解析日期: {date_str!r}")
        if end_of_day:
            dt = dt.replace(hour=23, minute=59, second=59)
        return dt.replace(tzinfo=_THS_TZ)

    @classmethod
    def _history_window_ms(cls, start_date: str, end_date: str) -> "tuple[int, int]":
        """解析起止日期为毫秒时间戳（东八区）；跨度超 10 年时截断起点并告警。"""
        end_dt = cls._parse_trade_date(end_date, end_of_day=True) if (end_date or "").strip() \
            else datetime.now(_THS_TZ)
        start_dt = cls._parse_trade_date(start_date, end_of_day=False) if (start_date or "").strip() \
            else end_dt.replace(hour=0, minute=0, second=59)
        if (end_dt - start_dt).days > _MAX_HISTORY_DAYS:
            logger.warning(
                "THS 历史 K 线窗口超过 %d 年，起点截断为 %s",
                _MAX_HISTORY_YEARS,
                (end_dt - pd.Timedelta(days=_MAX_HISTORY_DAYS)).date(),
            )
            start_dt = end_dt - pd.Timedelta(days=_MAX_HISTORY_DAYS)
        return int(start_dt.timestamp() * 1000), int(end_dt.timestamp() * 1000)

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        retry=retry_if_exception_type((ConnectionError, TimeoutError)),
        before_sleep=before_sleep_log(logger, logging.WARNING),
    )
    def _fetch_raw_data(self, stock_code: str, start_date: str, end_date: str) -> pd.DataFrame:
        """拉取 A 股历史日 K（前复权），offset 分页拉全窗口内数据。"""
        if self._client is None:
            raise DataFetchError("THS 客户端未初始化，请检查 HITHINK_FINANCE_API_KEY 配置")
        self._ensure_cn_stock(stock_code)
        ths_code = self._to_ths_code(stock_code)
        start_ms, end_ms = self._history_window_ms(start_date, end_date)

        items: List[Dict[str, Any]] = []
        offset = 0
        while True:
            page = self._request_items(
                "/api/a-share/prices/historical",
                {
                    "thscode": ths_code,
                    "interval": "1d",
                    "adjust": "forward",
                    "start": start_ms,
                    "end": end_ms,
                    "offset": offset,
                    "limit": _HISTORY_PAGE_SIZE,
                },
            )
            items.extend(page)
            if len(page) < _HISTORY_PAGE_SIZE:
                break
            offset += _HISTORY_PAGE_SIZE
            if offset >= _HISTORY_PAGE_SIZE * _HISTORY_MAX_PAGES:
                logger.warning("THS 历史 K 线分页超过防御上限，截断: %s", ths_code)
                break
        return pd.DataFrame(items)

    # 真实返回列名（2026-09-25 联调核对）→ 标准列名；仅做改名，不做单位换算
    _THS_KLINE_ALIASES = {
        "date_ms": "date",
        "open_price": "open",
        "high_price": "high",
        "low_price": "low",
        "close_price": "close",
        "turnover": "amount",
    }

    def _normalize_data(self, df: pd.DataFrame, stock_code: str) -> pd.DataFrame:
        """归一化历史日 K 到标准列。

        - 真实列名（``date_ms``/``*_price``/``turnover``）先经 ``_THS_KLINE_ALIASES`` 映射为标准列
        - ``date``：THS 毫秒时间戳 → 东八区 naive datetime
        - ``pct_chg``：接口无此字段，由相邻收盘价推导（首行 NaN 由 ``_clean_data`` 兜底）
        - ``volume`` / ``amount`` 单位已联调核对（2026-09-25，600519）：**volume=股、
          amount(turnover)=元**，与项目标准一致（tushare 侧 手×100/千元×1000 对齐同口径），
          透传不换算
        """
        df = df.copy()
        if df.empty:
            return df
        df = df.rename(
            columns={k: v for k, v in self._THS_KLINE_ALIASES.items() if k in df.columns}
        )

        date_col = next((c for c in ("date", "time", "timestamp") if c in df.columns), None)
        if date_col is None:
            raise DataFetchError("THS 历史 K 线响应缺少日期字段")
        df["date"] = (
            pd.to_datetime(df[date_col], unit="ms", utc=True)
            .dt.tz_convert("Asia/Shanghai")
            .dt.tz_localize(None)
        )

        if "close" in df.columns:
            df["pct_chg"] = df["close"].pct_change() * 100

        df["code"] = stock_code

        keep_cols = ["code"] + STANDARD_COLUMNS
        existing_cols = [col for col in keep_cols if col in df.columns]
        return df[existing_cols]

    # ============================================================
    # 池类接口（P1）
    # ============================================================

    _POOL_ENDPOINTS = {
        "limit_up": ("/api/a-share/special-data/limit-up-pool", "涨停池"),
        "limit_down": ("/api/a-share/special-data/limit-down-pool", "跌停池"),
        "blown": ("/api/a-share/special-data/limit-break-pool", "炸板池"),
    }

    def get_limit_up_pool(self, date: Optional[str] = None, n: int = 20) -> Optional[List[Dict[str, Any]]]:
        return self._fetch_pool("limit_up", date, n, board_field="consecutive_boards")

    def get_limit_down_pool(self, date: Optional[str] = None, n: int = 20) -> Optional[List[Dict[str, Any]]]:
        return self._fetch_pool("limit_down", date, n, board_field="continuous_down_days")

    def get_blown_pool(self, date: Optional[str] = None, n: int = 20) -> Optional[List[Dict[str, Any]]]:
        return self._fetch_pool("blown", date, n, board_field=None)

    @staticmethod
    def _normalize_pool_date(date: Optional[str]) -> Optional[str]:
        """``YYYYMMDD`` / ``YYYY-MM-DD`` → ``YYYY-MM-DD``；None → None（端点默认最新交易日）。"""
        text = (date or "").strip()
        if not text:
            return None
        normalized = text.replace("/", "-")
        if len(normalized) == 8 and normalized.isdigit():
            normalized = f"{normalized[:4]}-{normalized[4:6]}-{normalized[6:]}"
        return normalized

    def _fetch_pool(
        self,
        pool_type: str,
        date: Optional[str],
        n: int,
        board_field: Optional[str],
    ) -> Optional[List[Dict[str, Any]]]:
        """拉取并归一化池列表；无数据/失败返回 None（Manager 继续回落下一源）。"""
        if self._client is None:
            return None
        path, label = self._POOL_ENDPOINTS[pool_type]
        params: Dict[str, Any] = {
            "page": 1,
            "size": max(1, min(int(n or 20), _MAX_POOL_PAGE_SIZE)),
        }
        query_date = self._normalize_pool_date(date)
        if query_date:
            params["date"] = query_date
        try:
            items = self._request_items(path, params)
        except Exception as e:
            logger.warning("ThsFetcher 获取%s失败: %s", label, e)
            return None
        if not items:
            return None
        rows = [self._pool_row_from_item(item, board_field) for item in items]
        return rows[:n]

    @staticmethod
    def _first_of(item: Dict[str, Any], *keys: str) -> Any:
        """按候选键序取第一个非空值（THS 字段名待真调核对，候选键在此集中维护）。"""
        for key in keys:
            value = item.get(key)
            if value not in (None, ""):
                return value
        return None

    @staticmethod
    def _safe_float(value: Any) -> Optional[float]:
        try:
            if pd.isna(value):
                return None
            return float(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _safe_int(value: Any) -> int:
        try:
            if pd.isna(value):
                return 0
            return int(float(value))
        except (TypeError, ValueError):
            return 0

    @staticmethod
    def _normalize_limit_time(value: Any) -> str:
        """``HH:MM`` / ``HH:MM:SS`` / ``HHMMSS`` → 零填充 ``HHMMSS`` 字符串；缺失 → ``""``。

        语义对齐 ``AkshareFetcher._normalize_limit_time_value``（契约消费方一致）。
        """
        try:
            if pd.isna(value):
                return ""
        except TypeError:
            pass
        text = str(value).strip()
        if not text or text.lower() in {"nan", "nat", "none", "null", "-", "--"}:
            return ""
        if ":" in text:
            parts = text.split(":")
            try:
                hour = int(parts[0])
                minute = int(parts[1]) if len(parts) > 1 else 0
                second = int(parts[2]) if len(parts) > 2 else 0
                return f"{hour:02d}{minute:02d}{second:02d}"
            except (TypeError, ValueError):
                return text
        try:
            return f"{int(float(text)):06d}"
        except (TypeError, ValueError):
            digits = "".join(ch for ch in text if ch.isdigit())
            return digits.zfill(6) if digits else text

    def _pool_row_from_item(self, item: Dict[str, Any], board_field: Optional[str]) -> Dict[str, Any]:
        """THS 池 item → 统一池契约行（12 基础键 + 按池型的 boards 字段）。

        候选键以 design.md §三 记录的返回字段为主（continue_day_cnt / seal_money /
        open_times 等），并保留少量同义备选；真实字段名待首次联调核对后收敛。
        """
        row: Dict[str, Any] = {
            "code": str(self._first_of(item, "code", "stock_code", "thscode") or "").strip(),
            "name": str(self._first_of(item, "name", "stock_name") or "").strip(),
            "change_pct": self._safe_float(self._first_of(item, "change_pct", "change_percent")),
            "price": self._safe_float(self._first_of(item, "price", "last_price", "close")),
            "amount": self._safe_float(self._first_of(item, "amount", "turnover_value")),
            "turnover_rate": self._safe_float(self._first_of(item, "turnover_rate")),
            "seal_amount": self._safe_float(
                self._first_of(item, "seal_money", "seal_amount", "max_seal_money")
            ),
            "first_limit_time": self._normalize_limit_time(
                self._first_of(item, "first_limit_time", "first_seal_time", "limit_time")
            ),
            "last_limit_time": self._normalize_limit_time(
                self._first_of(item, "last_limit_time", "last_seal_time")
            ),
            "break_count": self._safe_int(self._first_of(item, "open_times", "break_count")),
            "limit_stat": str(self._first_of(item, "limit_stat") or "").strip(),
            "industry": str(self._first_of(item, "industry", "hy_name") or "").strip(),
        }
        if board_field:
            row[board_field] = self._safe_int(
                self._first_of(item, "continue_day_cnt", "consecutive_boards", "continuous_down_days")
            )
        return row

    # ============================================================
    # 指数行情（情绪页优先源，2026-09-25 联调通过）
    # ============================================================

    # thscode → 展示名（服务层 _parse_indices 按名称匹配；快照无 name 字段，本地映射）
    _THS_INDEX_CODES = {
        "000001.SH": "上证指数",
        "000016.SH": "上证50",
        "000300.SH": "沪深300",
        "399001.SZ": "深证成指",
        "399006.SZ": "创业板指",
        "000688.SH": "科创50",
        "399106.SZ": "深证综指",
        "899050.BJ": "北证50",
    }

    def get_main_indices(self, region: str = "cn") -> Optional[List[Dict[str, Any]]]:
        """主要指数实时快照（`/api/a-share-index/prices/snapshot`，批量）。

        契约字段：code/name/current/change/change_pct/volume/amount；
        amount(turnover) 单位为元，已联调核对：上证指数=沪市总额、
        深证成指/深证综指=深市总额（两值相同）。
        """
        if region != "cn" or self._client is None:
            return None
        try:
            items = self._request_items(
                "/api/a-share-index/prices/snapshot",
                {"thscodes": ",".join(self._THS_INDEX_CODES)},
            )
        except Exception as e:
            logger.warning("ThsFetcher 获取指数行情失败: %s", e)
            return None
        rows: List[Dict[str, Any]] = []
        for item in items:
            thscode = str(item.get("thscode") or "").strip()
            name = self._THS_INDEX_CODES.get(thscode)
            if not name:
                continue
            rows.append({
                "code": thscode.split(".", 1)[0],
                "name": name,
                "current": self._safe_float(item.get("last_price")),
                "change": self._safe_float(item.get("price_change")),
                "change_pct": self._safe_float(item.get("price_change_ratio_pct")),
                "volume": self._safe_float(item.get("volume")),
                "amount": self._safe_float(item.get("turnover")),
            })
        return rows or None

    # ============================================================
    # meta 搜索（P1 补名辅助通道，未接入实时路径）
    # ============================================================

    def _meta_search(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        """代码/名称消歧（``/api/meta/tickers/search``），供快照补名等场景使用。"""
        if self._client is None or not (query or "").strip():
            return []
        try:
            return self._request_items(
                "/api/meta/tickers/search", {"q": query.strip(), "limit": max(1, int(limit))}
            )
        except Exception as e:
            logger.warning("THS meta 搜索失败: %s", e)
            return []
