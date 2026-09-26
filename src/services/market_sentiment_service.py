# -*- coding: utf-8 -*-
"""大盘情绪页服务层：收盘采集 + 快照查询 + 明日重点生成。

设计要点（见 redesign/features/market-sentiment/）：
- 历史读快照表，实时读 data_provider；
- 任一数据缺失仅记入 degraded，不拖垮整个采集流程；
- 双维度情绪温度 v1 为规则计算，后续可替换为模型。
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections import Counter
from datetime import date, datetime, time as dt_time, timedelta
from typing import Any, Dict, List, Optional

from src.core.trading_calendar import (
    MarketPhase,
    get_effective_trading_date,
    get_market_now,
    infer_market_phase,
    is_market_open,
)
from src.repositories.market_sentiment_repo import MarketSentimentRepository
from src.storage import DatabaseManager

logger = logging.getLogger(__name__)

_MAX_LADDER_HEIGHT = 5          # 梯度统计到 5 板及以上
_FOCUS_SECTOR_LIMIT = 8         # 板块排行拉取条数
_LIMIT_POOL_FETCH_N = 500       # 拉全量涨停池用于梯度聚合（manager 默认截断 20）

# ---------------- 阶段感知读数（盘中实时 / 盘后补采 / 其余纯读库） ----------------
_REALTIME_PHASES = frozenset({
    MarketPhase.INTRADAY,
    MarketPhase.LUNCH_BREAK,
    MarketPhase.CLOSING_AUCTION,
})
_REALTIME_TTL_SECONDS = 60.0                    # 盘中实时块缓存窗口，避免每次拉全市场
_AUTO_COLLECT_MIN_LOCAL_TIME = dt_time(15, 5)   # 收盘缓冲：等涨跌停池定型
_realtime_cache: Dict[str, Any] = {'data': None, 'expires_at': 0.0}
_realtime_cache_lock = threading.Lock()
_auto_collect_state: Dict[str, str] = {}        # trade_date ISO -> running/done
_auto_collect_lock = threading.Lock()

# 历史回填用指数 → 快照字段前缀（canonical 代码；上证/深证综指兼作沪深成交额口径）
_BACKFILL_INDEX_CODES = {
    'sh000001': 'sh',
    'sz399106': 'sz',
    'sh000300': 'hs300',
    'sh000016': 'sh50',
    'sz399006': 'chinext',
}

# tushare index_daily 的沪市成交额（千元）换算到亿元：÷ 1e5
_TUSHARE_SH_AMOUNT_SCALE = 100_000.0


def _fetch_sh_amount_yi_by_date(dates: List[date]) -> Dict[date, float]:
    """回填专用：tushare index_daily 补沪市成交额（单位亿元）。

    指数日线 fallback 源（新浪/腾讯）只有成交量没有成交额，东财限流时
    sh_amount/total_amount 会整体缺失。tushare ``000001.SH`` 的 amount
    为千元口径。token 未配置或调用失败返回 {}，由调用方按缺数据处理。
    """
    if not dates:
        return {}
    try:
        from data_provider.tushare_fetcher import _TushareHttpClient
        from src.config import get_config
        token = get_config().tushare_token
        if not token:
            return {}
        client = _TushareHttpClient(token=token)
        df = client.index_daily(
            ts_code='000001.SH',
            start_date=min(dates).strftime('%Y%m%d'),
            end_date=max(dates).strftime('%Y%m%d'),
            fields='trade_date,amount',
        )
        result: Dict[date, float] = {}
        for _, row in df.iterrows():
            try:
                day = date.fromisoformat(str(row.get('trade_date', '')))
                amount = float(row.get('amount'))
            except (TypeError, ValueError):
                continue
            if amount > 0:
                result[day] = round(amount / _TUSHARE_SH_AMOUNT_SCALE, 2)
        return result
    except Exception as exc:
        logger.warning("[情绪回填] 沪市成交额补齐失败（tushare）: %s", exc)
        return {}


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _to_float(value: Any) -> Optional[float]:
    """宽松转 float（NaN/None/非法串 → None）。"""
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None    # NaN → None


def compute_sentiment_st(
    stats: Dict[str, Any],
    ladder: Dict[str, Any],
    blown_rate: Optional[float] = None,
) -> Optional[int]:
    """短线情绪温度（0~100，规则版）。

    输入：涨跌统计 + 涨停梯队聚合结果（+ 可选炸板率，缺省回落到梯队字段）。
    维度：涨停家数、炸板率、空间板高度、涨跌家数比。
    """
    limit_up = stats.get('limit_up_count')
    up = stats.get('up_count')
    down = stats.get('down_count')
    if limit_up is None or up is None or down is None:
        return None

    score = 50.0
    # 涨停家数：以 30 家为中性，每 4 家 ±1 分，封顶 ±20
    score += _clamp((limit_up - 30) / 4.0, -20, 20)

    if blown_rate is None:
        blown_rate = ladder.get('blown_rate')
    if blown_rate is not None:
        # 炸板率：以 15% 为中性，每 2% ∓1 分，封顶 ±15
        score += _clamp((15.0 - blown_rate) / 2.0, -15, 15)

    max_height = ladder.get('max_height')
    if max_height:
        # 空间板：以 4 板为中性，每板 ±3 分，封顶 ±10
        score += _clamp((max_height - 4) * 3.0, -10, 10)

    if up + down > 0:
        # 涨跌家数比：净涨比例映射 ±10
        score += _clamp((up - down) / (up + down) * 30.0, -10, 10)

    return int(round(_clamp(score, 0, 100)))


def compute_sentiment_trend(
    indices: Dict[str, Any], stats: Dict[str, Any], amount_vs_prev: Optional[float]
) -> Optional[int]:
    """趋势情绪温度（0~100，规则版）。

    输入：指数涨跌 + 涨跌家数 + 量能变化。
    """
    hs300 = indices.get('hs300_chg_pct')
    up = stats.get('up_count')
    down = stats.get('down_count')
    if hs300 is None or up is None or down is None:
        return None

    score = 50.0
    # 沪深300：1% ≈ 8 分，封顶 ±20
    score += _clamp(hs300 * 8.0, -20, 20)

    chinext = indices.get('chinext_chg_pct')
    if chinext is not None:
        # 创业板：1% ≈ 4 分，封顶 ±10
        score += _clamp(chinext * 4.0, -10, 10)

    if amount_vs_prev is not None:
        # 量能：较前日每 ±10% ≈ ±4 分，封顶 ±10
        score += _clamp(amount_vs_prev * 0.4, -10, 10)

    if up + down > 0:
        score += _clamp((up - down) / (up + down) * 20.0, -15, 15)

    return int(round(_clamp(score, 0, 100)))


def aggregate_ladder(
    pool: List[Dict[str, Any]], prev_limit_up_total: Optional[int]
) -> Dict[str, Any]:
    """从涨停池聚合梯队快照字段（不落库）。"""
    heights = Counter()
    seal_hours = Counter()
    sector_counter = Counter()
    max_height = 0
    max_row: Dict[str, Any] = {}

    for item in pool:
        boards = item.get('consecutive_boards') or 1
        bucket = min(boards, _MAX_LADDER_HEIGHT)
        heights[bucket] += 1
        if boards > max_height:
            max_height = boards
            max_row = item

        first_time = str(item.get('first_limit_time') or '')
        if len(first_time) >= 2 and first_time[:2].isdigit():
            seal_hours[f"{first_time[:2]}时"] += 1

        industry = str(item.get('industry') or '').strip()
        if industry:
            sector_counter[industry] += 1

    height_counts = {
        'height_1': heights.get(1, 0),
        'height_2': heights.get(2, 0),
        'height_3': heights.get(3, 0),
        'height_4': heights.get(4, 0),
        'height_5plus': heights.get(_MAX_LADDER_HEIGHT, 0),
    }

    # 梯队完整度：1..max_height-1 每级都非零才完整
    ladder_complete = None
    if max_height >= 2:
        ladder_complete = int(
            all(heights.get(h, 0) > 0 for h in range(1, max_height))
        )
    elif max_height == 1:
        ladder_complete = 1

    # 昨日涨停今日继续 = 今日二板及以上合计
    prev_again = sum(
        heights.get(h, 0) for h in range(2, _MAX_LADDER_HEIGHT + 1)
    )

    return {
        **height_counts,
        'max_height': max_height or None,
        'max_height_code': (max_row.get('code') or None) if max_row else None,
        'max_height_name': (max_row.get('name') or None) if max_row else None,
        'ladder_complete': ladder_complete,
        'first_seal_dist': dict(seal_hours) if seal_hours else None,
        'sector_dist': (
            [{'sector': s, 'count': c} for s, c in sector_counter.most_common(5)]
            if sector_counter else None
        ),
        'prev_limit_up_total': prev_limit_up_total,
        'prev_limit_up_again': prev_again or None,
        'prev_limit_up_blown': None,   # 炸板池无统一契约，v1 置空
        'prev_limit_up_down': None,
    }


def _parse_indices(indices: List[Dict[str, Any]]) -> Dict[str, Any]:
    """将指数列表解析为情绪页所需的索引字段。"""
    result: Dict[str, Any] = {}
    for item in indices or []:
        name = str(item.get('name') or '')
        chg = item.get('change_pct')
        if '沪深300' in name or name == '沪深300':
            result['hs300_chg_pct'] = chg
            result['hs300_close'] = item.get('current')
        elif '上证50' in name:
            result['sh50_chg_pct'] = chg
        elif '创业板' in name:
            result['chinext_chg_pct'] = chg
        elif name == '上证指数':
            result['sh_close'] = item.get('current')
            result['sh_chg_pct'] = chg

    # 沪深成交额拆分（入参单位元 → 存亿元，与 total_amount 口径一致）。
    # 仅采信"上证指数"与"深证综指"行：上证指数成交额=沪市总额，深证综指=深市总额；
    # 深证成指在部分数据源为成份股口径，不采，避免跨源语义漂移。
    for item in indices or []:
        if (
            result.get('sh_amount') is not None
            and result.get('sz_amount') is not None
        ):
            break
        name = str(item.get('name') or '')
        amount = item.get('amount')
        if amount is None:
            continue
        try:
            amount_yi = round(float(amount) / 1e8, 2)
        except (TypeError, ValueError):
            continue
        if name == '上证指数' and result.get('sh_amount') is None:
            result['sh_amount'] = amount_yi
        elif name == '深证综指' and result.get('sz_amount') is None:
            result['sz_amount'] = amount_yi
    return result


# 外盘摘要键映射（与 storage-design.md §2.1 overseas_summary 契约对齐）
_OVERSEAS_CODE_KEY = {
    'SPX': 'spx_chg',    # 标普500
    'IXIC': 'ndx_chg',   # 纳斯达克综合
    'DJI': 'dji_chg',    # 道琼斯
    'VIX': 'vix',        # VIX（存点位而非涨跌幅）
    'KS11': 'kospi_chg',   # 韩国KOSPI
    'KQ11': 'kosdaq_chg',  # 韩国KOSDAQ
}

# 周热点事件规则打标关键词（规则版 v1，LLM 提炼留 Phase 2）
_EVENT_POLICY_WORDS = (
    '政策', '央行', '证监会', '国务院', '发改委', '财政部',
    '金融监管', '政治局', '国常会', '工信部', '国资委', '商务部',
)
_EVENT_EARNINGS_WORDS = (
    '业绩', '财报', '季报', '年报', '预增', '预亏', '中标',
    '回购', '分红', '营收', '订单', '签约',
)
_EVENT_MACRO_WORDS = (
    'GDP', 'CPI', 'PPI', 'PMI', '美联储', '加息', '降息',
    '通胀', '汇率', '国债', 'LPR', 'MLF', '社融',
)
_EVENT_POSITIVE_WORDS = (
    '利好', '上涨', '大涨', '涨停', '新高', '突破', '增长', '超预期',
    '增持', '走强', '拉升', '提振',
)
_EVENT_NEGATIVE_WORDS = (
    '利空', '下跌', '大跌', '跌停', '新低', '下滑', '下降', '低于预期',
    '处罚', '立案', '减持', '走弱', '跳水', '回落', '下调',
)

# 财经日历（明日重点 / 周聚焦 / 月聚焦事件数据源）
_CALENDAR_NOISE_WORDS = ('持仓', '库存变动', '仓单变动', '每日更新')  # 例行数据噪音
_CALENDAR_MAJOR_WORDS = ('利率决议', 'CPI', '非农', 'GDP', 'PMI', '通胀', '就业')
_TOMORROW_KEY_EVENTS_LIMIT = 8   # 明日重点·关键事件条数
_WEEK_FORWARD_LIMIT = 10         # 周聚焦·本周前瞻条数
_MONTH_FORWARD_LIMIT = 15        # 月聚焦·本月重点日程条数
_PERIOD_REVIEW_LIMIT = 5         # 上一周期热点回顾条数
_PERIOD_LOOKBACK_LIMIT = 5      # 周期板块/个股回溯榜条数
_CALENDAR_PER_DAY_LIMIT = 2     # 日历前瞻每日最多条数（防密集日吃满名额）


def _is_calendar_noise(event: str) -> bool:
    """财经日历例行数据噪音过滤（importance≥2 混有持仓/库存类例行项）。"""
    return any(w in event for w in _CALENDAR_NOISE_WORDS)


def _is_key_calendar_event(ev: Dict[str, Any]) -> bool:
    """重点事件：importance 3 或重大类关键词（利率决议/CPI/非农/GDP/PMI/通胀/就业）。"""
    if (ev.get('importance') or 0) >= 3:
        return True
    return any(w in str(ev.get('event') or '') for w in _CALENDAR_MAJOR_WORDS)


def _calendar_summary(ev: Dict[str, Any]) -> Optional[str]:
    """日历事件摘要：'HH:MM ｜ 预期 x ｜ 前值 y'（缺项省略）。"""
    parts: List[str] = []
    if ev.get('time'):
        parts.append(str(ev['time']))
    if ev.get('expect'):
        parts.append(f"预期 {ev['expect']}")
    if ev.get('previous'):
        parts.append(f"前值 {ev['previous']}")
    return ' ｜ '.join(parts) or None


class MarketSentimentService:
    """大盘情绪页：采集（写）与查询（读）。"""

    def __init__(
        self,
        db_manager: Optional[DatabaseManager] = None,
        fetcher_manager: Any = None,
    ):
        self.db = db_manager or DatabaseManager.get_instance()
        self.repo = MarketSentimentRepository(self.db)
        self._fetcher_manager = fetcher_manager

    def _get_fetcher_manager(self):
        if self._fetcher_manager is None:
            from data_provider import DataFetcherManager
            self._fetcher_manager = DataFetcherManager()
        return self._fetcher_manager

    # ------------------------------------------------------------------
    # 采集（写路径）
    # ------------------------------------------------------------------

    def collect_daily_snapshot(
        self, trade_date: Optional[date] = None
    ) -> Dict[str, Any]:
        """收盘后采集当日快照：市场统计 + 指数 + 涨停梯队 + 板块聚焦。

        单一数据源失败不拖垮整体，缺失项记入 degraded。
        """
        trade_date = trade_date or self._resolve_snapshot_trade_date()
        degraded: List[str] = []
        manager = self._get_fetcher_manager()

        # 1. 市场涨跌统计
        stats: Dict[str, Any] = {}
        try:
            stats = manager.get_market_stats(purpose="market_sentiment") or {}
        except Exception as exc:
            logger.warning("[情绪采集] 市场统计获取失败: %s", exc)
        if not stats:
            degraded.append('market_stats')

        # 2. 指数收盘
        try:
            indices_raw = manager.get_main_indices(region='cn') or []
        except Exception as exc:
            logger.warning("[情绪采集] 指数行情获取失败: %s", exc)
            indices_raw = []
        indices = _parse_indices(indices_raw)
        if not indices:
            degraded.append('indices')

        # 2.5 外盘摘要（美股昨夜收盘 + 韩股盘中；单一市场失败只记 degraded）
        overseas, overseas_degraded = self._collect_overseas(manager)
        degraded.extend(overseas_degraded)

        # 3. 三类池明细（涨停/跌停/炸板，拉全量用于梯队聚合与明细落库；
        #    数据源偶发重复行，按代码去重；空池≠失败，异常才记 degraded）
        pools: Dict[str, List[Dict[str, Any]]] = {}
        pool_failed: List[str] = []
        for pool_type, fetch in (
            ('limit_up', lambda: manager.get_limit_up_pool(n=_LIMIT_POOL_FETCH_N)),
            ('limit_down', lambda: manager.get_limit_down_pool(n=_LIMIT_POOL_FETCH_N)),
            ('blown', lambda: manager.get_blown_pool(n=_LIMIT_POOL_FETCH_N)),
        ):
            raw: List[Dict[str, Any]] = []
            try:
                raw = fetch() or []
            except Exception as exc:
                logger.warning("[情绪采集] %s获取失败: %s", pool_type, exc)
                pool_failed.append(pool_type)
            deduped: List[Dict[str, Any]] = []
            seen_codes: set = set()
            for item in raw:
                code = str(item.get('code') or '').strip()
                if not code or code in seen_codes:
                    continue
                seen_codes.add(code)
                deduped.append(item)
            pools[pool_type] = deduped
        pool = pools.get('limit_up') or []
        if not pool:
            degraded.append('limit_up_pool')
        degraded.extend(f"{t}_pool" for t in ('limit_down', 'blown') if t in pool_failed)

        # 4. 板块排行
        try:
            top_sectors, bottom_sectors = manager.get_sector_rankings(n=_FOCUS_SECTOR_LIMIT)
        except Exception as exc:
            logger.warning("[情绪采集] 板块排行获取失败: %s", exc)
            top_sectors, bottom_sectors = [], []
        if not top_sectors:
            degraded.append('sector_rankings')

        # 5. 上一交易日快照（计算量能环比 / 昨日涨停基数，排除当日避免自比）
        prev_snapshot = self.repo.get_latest_snapshot(exclude_date=trade_date)
        amount_vs_prev = None
        total_amount = stats.get('total_amount')
        if (
            total_amount is not None
            and prev_snapshot is not None
            and prev_snapshot.total_amount
        ):
            amount_vs_prev = round(
                (total_amount - prev_snapshot.total_amount)
                / prev_snapshot.total_amount * 100, 1
            )

        # 6. 炸板率 + 梯度聚合 + 双温度
        limit_up_total = stats.get('limit_up_count')
        if limit_up_total is None:
            limit_up_total = len(pool)
        blown_count = None if 'blown' in pool_failed else len(pools.get('blown') or [])
        blown_rate = None
        if blown_count is not None and (limit_up_total or 0) + blown_count > 0:
            blown_rate = round(
                blown_count / ((limit_up_total or 0) + blown_count) * 100, 1
            )
        prev_limit_up_total = (
            prev_snapshot.limit_up_count if prev_snapshot else None
        )
        ladder = aggregate_ladder(pool, prev_limit_up_total)
        sentiment_st = compute_sentiment_st(stats, ladder, blown_rate=blown_rate)
        sentiment_trend = compute_sentiment_trend(indices, stats, amount_vs_prev)

        # 7. 写每日快照
        snapshot = self.repo.upsert_daily_snapshot({
            'trade_date': trade_date,
            'total_amount': total_amount,
            'amount_vs_prev': amount_vs_prev,
            'sh_amount': indices.get('sh_amount'),
            'sz_amount': indices.get('sz_amount'),
            'up_count': stats.get('up_count'),
            'down_count': stats.get('down_count'),
            'flat_count': stats.get('flat_count'),
            'limit_up_count': stats.get('limit_up_count'),
            'limit_down_count': stats.get('limit_down_count'),
            'blown_count': blown_count,
            'blown_rate': blown_rate,
            'sentiment_st': sentiment_st,
            'sentiment_trend': sentiment_trend,
            'main_inflow': None,    # 主力净流入无统一契约，v1 置空
            'north_inflow': None,
            'hs300_close': indices.get('hs300_close'),
            'hs300_chg_pct': indices.get('hs300_chg_pct'),
            'sh50_chg_pct': indices.get('sh50_chg_pct'),
            'chinext_chg_pct': indices.get('chinext_chg_pct'),
            'sh_close': indices.get('sh_close'),
            'sh_chg_pct': indices.get('sh_chg_pct'),
            'new_high_60d': None,
            'new_low_60d': None,
            'overseas_summary': (
                json.dumps(overseas, ensure_ascii=False) if overseas else None
            ),
            'is_complete': 1,
        })

        # 8. 写涨停梯队快照
        if pool:
            self.repo.upsert_ladder_snapshot({'trade_date': trade_date, **ladder})

        # 8.5 写三类池明细快照（盘后读路径的数据源）
        for pool_type, rows in pools.items():
            if rows:
                self.repo.refresh_pool_details(
                    trade_date, pool_type,
                    [self._pool_row_to_fields(item) for item in rows],
                )

        # 9. 周期聚焦内容（周聚焦/月聚焦：事件 + 上一周期板块/个股回溯，周期内幂等）
        focus_written = self._generate_period_focus(manager, trade_date)

        # 9.5 每日热点事件（规则版 v1：市场级财经快讯 + 关键词打标，失败仅记 degraded）
        try:
            news = manager.get_market_news(n=100) or []
        except Exception as exc:
            logger.warning("[情绪采集] 财经快讯获取失败: %s", exc)
            news = []
        if news:
            sector_words = self._collect_event_sector_words(top_sectors, pool)
            added = self._add_focus_events(
                self._build_focus_events(news, sector_words, trade_date)
            )
            logger.info("[情绪采集] 每日热点事件新增 %s 条", added)
        else:
            degraded.append('focus_events')

        collected = {
            'trade_date': str(trade_date),
            'snapshot_id': snapshot.id,
            'sentiment_st': sentiment_st,
            'sentiment_trend': sentiment_trend,
            'limit_up_pool_size': len(pool),
            'limit_down_pool_size': len(pools.get('limit_down') or []),
            'blown_pool_size': len(pools.get('blown') or []),
            'focus_stocks': focus_written.get('stocks', 0),
            'focus_sectors': focus_written.get('sectors', 0),
            'degraded': degraded,
        }
        logger.info("[情绪采集] 完成: %s", collected)
        return collected

    @staticmethod
    def _pool_row_to_fields(item: Dict[str, Any]) -> Dict[str, Any]:
        """data_provider 池契约行 → market_pool_detail_snapshot 字段。"""
        return {
            'stock_code': str(item.get('code') or '').strip(),
            'stock_name': item.get('name'),
            'industry': item.get('industry'),
            'chg_pct': item.get('change_pct'),
            'price': item.get('price'),
            'amount': item.get('amount'),
            'turnover_rate': item.get('turnover_rate'),
            'seal_amount': item.get('seal_amount'),
            'first_limit_time': item.get('first_limit_time') or '',
            'last_limit_time': item.get('last_limit_time') or '',
            'break_count': item.get('break_count'),
            'limit_stat': item.get('limit_stat') or '',
            'boards': (
                item.get('consecutive_boards')
                if item.get('consecutive_boards') is not None
                else item.get('continuous_down_days')
            ),
        }

    @staticmethod
    def _collect_overseas(manager: Any) -> tuple:
        """采集外盘摘要：美股昨夜（SPX/纳指/道指/VIX）+ 韩股盘中（KOSPI/KOSDAQ）。

        Returns:
            (summary, degraded)：summary 为 None 或
            {"spx_chg":..,"ndx_chg":..,"dji_chg":..,"vix":..,"kospi_chg":..,"kosdaq_chg":..}；
            单一市场整体失败时在该市场维度记 degraded，不拖垮采集。
        """
        summary: Dict[str, Any] = {}
        degraded: List[str] = []
        for region, tag in (('us', 'overseas_us'), ('kr', 'overseas_kr')):
            region_keys = 0
            try:
                indices = manager.get_main_indices(region=region) or []
            except Exception as exc:
                logger.warning("[情绪采集] 外盘(%s)获取失败: %s", region, exc)
                indices = []
            for item in indices:
                key = _OVERSEAS_CODE_KEY.get(str(item.get('code') or '').upper())
                if key is None:
                    continue
                if key == 'vix':
                    summary['vix'] = item.get('current')
                else:
                    summary[key] = item.get('change_pct')
                region_keys += 1
            if region_keys == 0:
                degraded.append(tag)
        return (summary or None), degraded

    @staticmethod
    def _collect_event_sector_words(
        top_sectors: List[Dict[str, Any]], pool: List[Dict[str, Any]]
    ) -> List[str]:
        """事件关联板块词表：今日热点板块 + 涨停池行业（去重保序）。"""
        words: List[str] = []
        for item in top_sectors or []:
            name = str(item.get('name') or '').strip()
            if name and name not in words:
                words.append(name)
        for item in pool or []:
            ind = str(item.get('industry') or '').strip()
            if ind and ind not in words:
                words.append(ind)
        return words

    @staticmethod
    def _build_focus_events(
        news: List[Dict[str, Any]],
        sector_words: List[str],
        trade_date: date,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """市场级财经快讯 → 周热点事件（规则打标 v1）。

        只保留当日快讯；情绪按正/负关键词计分（正多判利好、负多判利空、
        持平判中性）；关联板块按词表命中标题+摘要。
        """
        rows: List[Dict[str, Any]] = []
        seen_titles: set = set()
        date_prefix = str(trade_date)
        for item in news:
            title = str(item.get('title') or '').strip()
            if not title or title in seen_titles:
                continue
            published = str(item.get('published_at') or '')
            if published and not published.startswith(date_prefix):
                continue
            seen_titles.add(title)

            text = f"{title} {item.get('summary') or ''}"
            pos = sum(text.count(w) for w in _EVENT_POSITIVE_WORDS)
            neg = sum(text.count(w) for w in _EVENT_NEGATIVE_WORDS)
            sentiment = 'positive' if pos > neg else 'negative' if neg > pos else 'neutral'

            if any(w in text for w in _EVENT_POLICY_WORDS):
                event_type = 'policy'
            elif any(w in text for w in _EVENT_EARNINGS_WORDS):
                event_type = 'earnings'
            elif any(w in text for w in _EVENT_MACRO_WORDS):
                event_type = 'macro'
            else:
                event_type = 'news'

            rows.append({
                'event_date': trade_date,
                'scope': 'week',
                'title': title,
                'source': item.get('source'),
                'event_type': event_type,
                'sentiment': sentiment,
                'related_sectors': [w for w in sector_words if w in text][:3],
                'related_stocks': [],
                'impact_label': {
                    'positive': '利好催化', 'negative': '短期利空',
                }.get(sentiment, '中性关注'),
                'impact_magnitude': None,
                'summary': item.get('summary'),
            })
            if len(rows) >= limit:
                break
        return rows

    # ------------------------------------------------------------------
    # 周期聚焦（周聚焦/月聚焦：周期内生成一次，幂等守卫）
    # ------------------------------------------------------------------

    def _add_focus_events(self, rows: List[Dict[str, Any]]) -> int:
        """批量写入聚焦事件，(event_date, scope, title) 重复幂等跳过。"""
        added = 0
        for fields in rows:
            try:
                self.repo.add_focus_event(fields)
                added += 1
            except ValueError:
                pass
        return added

    def _generate_period_focus(
        self, manager: Any, trade_date: date
    ) -> Dict[str, int]:
        """周聚焦/月聚焦周期内容：事件（日历前瞻）+ 板块/个股（上一周期回溯）。

        周聚焦 = 未来 7 天滚动窗口，每日采集刷新（守卫：当日已写过日历事件则跳过）；
        月聚焦 = 本月 1 日→月末，整月固定（守卫：本月已写过日历事件则跳过）。
        生成失败下次采集自动重试；假期顺延到节后首个采集日补生成。
        """
        written: Dict[str, int] = {}
        month_start = trade_date.replace(day=1)

        if not self.repo.has_focus_events_since(
            'week', datetime(trade_date.year, trade_date.month, trade_date.day),
            event_type='calendar',
        ):
            count = self._generate_week_events(manager, trade_date)
            if count:
                written['week_events'] = count
        if not self.repo.has_focus_events_since(
            'month', datetime(month_start.year, month_start.month, month_start.day),
            event_type='calendar',
        ):
            count = self._generate_month_events(manager, month_start)
            if count:
                written['month_events'] = count

        # 板块/个股回溯（守卫：周期起点后已写过聚合行则跳过；周=滚动窗按日刷新）
        for scope, period_start, prev_days in (
            ('week', trade_date, self._period_days(trade_date - timedelta(days=7), 7)),
            ('month', month_start, self._period_days(
                (month_start - timedelta(days=1)).replace(day=1),
                (month_start - timedelta(days=1)).day,
            )),
        ):
            try:
                generated = False
                for kind in ('stock', 'sector'):
                    if (self.repo.latest_focus_date(scope, kind) or date.min) < period_start:
                        generated = True
                if not generated:
                    continue
                stocks = self._build_period_stock_rows(prev_days)
                sectors = self._build_period_sector_rows(manager, prev_days)
                if not stocks and not sectors:
                    logger.info(
                        "[%s聚焦] 上一周期无池明细数据，回溯聚合跳过，下次采集重试", scope,
                    )
                    continue
                today = date.today()
                self.repo.refresh_focus_stocks(today, scope, stocks)
                self.repo.refresh_focus_sectors(today, scope, sectors)
                written[f'{scope}_stocks'] = len(stocks)
                written[f'{scope}_sectors'] = len(sectors)
                logger.info(
                    "[%s聚焦] 回溯聚合完成：板块 %s 行 / 个股 %s 行（区间 %s ~ %s）",
                    scope, len(sectors), len(stocks), prev_days[0], prev_days[-1],
                )
            except Exception as exc:
                logger.warning("[%s聚焦] 板块/个股回溯聚合失败: %s", scope, exc)
        return written

    @staticmethod
    def _period_days(start: date, count: int) -> List[date]:
        return [start + timedelta(days=i) for i in range(count)]

    @staticmethod
    def _future_first_days(days: List[date]) -> List[date]:
        """今日及之后的日期排前（周期中途补生成时优先覆盖剩余日程）。"""
        today = date.today()
        return [d for d in days if d >= today] + [d for d in days if d < today]

    def _generate_week_events(self, manager: Any, window_start: date) -> int:
        """周聚焦事件：今日→未来 7 天财经日历前瞻（假期照查），≤10 条，每日刷新。"""
        days = self._period_days(window_start, 7)
        forward = self._fetch_calendar_events(manager, days, 'week', _WEEK_FORWARD_LIMIT)
        if not forward:
            logger.warning("[周聚焦] 财经日历无前瞻事件，本轮不落库，下次采集重试")
            return 0
        added = self._add_focus_events(forward)
        logger.info("[周聚焦] 未来 7 天前瞻事件新增 %s 条", added)
        return added

    def _generate_month_events(self, manager: Any, month_start: date) -> int:
        """月聚焦事件：本月 1 日→月末财经日历（假期照查），重点类排前，≤15 条。"""
        end = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        days = self._future_first_days(
            self._period_days(month_start, (end - month_start).days + 1),
        )
        forward = self._fetch_calendar_events(
            manager, days, 'month', _MONTH_FORWARD_LIMIT, key_first=True,
        )
        if not forward:
            logger.warning("[月聚焦] 财经日历无前瞻事件，本轮不落库，下次采集重试")
            return 0
        added = self._add_focus_events(forward)
        logger.info("[月聚焦] 本月重点日程生成 %s 条", added)
        return added

    def _fetch_calendar_events(
        self,
        manager: Any,
        days: List[date],
        scope: str,
        limit: int,
        key_first: bool = False,
    ) -> List[Dict[str, Any]]:
        """逐日查财经日历 → focus_event 字段列表（importance≥2，噪音过滤）。

        days 需已按优先级排序（未来日优先）；每日最多 2 条（日内重点类优先），
        边迭代边填满 limit 名额后停止，保证剩余日程优先入选；
        返回前按日期时间升序排列（读路径按日分组渲染）。
        """
        selected: List[Dict[str, Any]] = []
        for d in days:
            if len(selected) >= limit:
                break
            try:
                calendar = manager.get_economic_calendar(str(d)) or []
            except Exception as exc:
                logger.warning("[聚焦事件] %s 财经日历获取失败: %s", d, exc)
                calendar = []
            day_rows: List[Dict[str, Any]] = []
            for ev in calendar:
                event = str(ev.get('event') or '').strip()
                if not event or (ev.get('importance') or 0) < 2:
                    continue
                if _is_calendar_noise(event):
                    continue
                day_rows.append(self._calendar_event_fields(
                    d, ev, scope, key=_is_key_calendar_event(ev),
                ))
            # 日内排序：重点类优先（月聚焦），其余按时间
            day_rows.sort(key=lambda r: (
                0 if key_first and r['impact_label'] == '重点关注' else 1,
                r.pop('_time') or '',
            ))
            for row in day_rows[:_CALENDAR_PER_DAY_LIMIT]:
                if len(selected) >= limit:
                    break
                selected.append(row)
        selected.sort(key=lambda r: (r['event_date'], r['summary'] or ''))
        return selected

    @staticmethod
    def _calendar_event_fields(
        d: date, ev: Dict[str, Any], scope: str, key: bool,
    ) -> Dict[str, Any]:
        region = str(ev.get('region') or '').strip()
        event = str(ev.get('event') or '').strip()
        return {
            'event_date': d,
            'scope': scope,
            'title': f"[{region}] {event}" if region else event,
            'source': '财经日历',
            'event_type': 'calendar',
            'sentiment': None,
            'related_sectors': [],
            'related_stocks': [],
            'impact_label': '重点关注' if key else '全球关注',
            'impact_magnitude': str(ev.get('importance') or ''),
            'summary': _calendar_summary(ev),
            '_time': str(ev.get('time') or ''),
        }

    def _build_period_stock_rows(self, days: List[date]) -> List[Dict[str, Any]]:
        """上一周期最高连板个股（空间榜）：池明细逐日聚合，按最高连板数排序。"""
        agg: Dict[str, Dict[str, Any]] = {}
        for d in days:
            for row in self.repo.list_pool_details(d, 'limit_up'):
                code = str(row.stock_code or '').strip()
                if not code:
                    continue
                a = agg.setdefault(code, {
                    'name': row.stock_name, 'industry': (row.industry or '').strip(),
                    'boards_max': 0, 'gain': 1.0, 'days': 0,
                })
                boards = row.boards or 0
                if boards > a['boards_max']:
                    a['boards_max'] = boards
                    a['industry'] = (row.industry or '').strip() or a['industry']
                if row.chg_pct is not None:
                    a['gain'] *= (1 + row.chg_pct / 100)
                    a['days'] += 1
        ranked = sorted(
            agg.items(), key=lambda kv: (kv[1]['boards_max'], kv[1]['gain']), reverse=True,
        )[:_PERIOD_LOOKBACK_LIMIT]
        rows: List[Dict[str, Any]] = []
        for code, a in ranked:
            rows.append({
                'stock_code': code,
                'stock_name': a['name'],
                'concept_tags': [a['industry']] if a['industry'] else [],
                'boards': a['boards_max'],
                'reason': f"区间最高 {a['boards_max']} 板 · 上榜 {a['days']} 天",
                'chg_pct': round((a['gain'] - 1) * 100, 1) if a['days'] else None,
                'turnover_rate': None,
                'main_inflow': None,
                'dragon_tiger': 0,
                'inst_buy': 0,
            })
        return rows

    def _build_period_sector_rows(
        self, manager: Any, days: List[date]
    ) -> List[Dict[str, Any]]:
        """上一周期板块涨幅榜：池明细聚合候选（涨停家数），逐板块查区间行情取真实涨幅。"""
        agg: Dict[str, Dict[str, Any]] = {}
        for d in days:
            for row in self.repo.list_pool_details(d, 'limit_up'):
                ind = str(row.industry or '').strip()
                if not ind:
                    continue
                a = agg.setdefault(ind, {'count': 0, 'boards_max': 0, 'leader': None, 'daily': {}})
                a['count'] += 1
                boards = row.boards or 0
                if boards > a['boards_max']:
                    a['boards_max'] = boards
                    a['leader'] = (row.stock_code, row.stock_name)
                key = str(d)
                a['daily'][key] = a['daily'].get(key, 0) + 1
        # 候选按涨停家数取前 2N，逐板块查区间涨幅，凑满 N 个有涨幅的为止
        candidates = sorted(
            agg.items(), key=lambda kv: kv[1]['count'], reverse=True,
        )[:_PERIOD_LOOKBACK_LIMIT * 2]
        start_s, end_s = days[0].strftime('%Y%m%d'), days[-1].strftime('%Y%m%d')
        rows: List[Dict[str, Any]] = []
        for name, a in candidates:
            try:
                hist = manager.get_sector_history(name, start_s, end_s) or []
            except Exception as exc:
                logger.warning("[周期回溯] 板块 %s 区间行情获取失败: %s", name, exc)
                hist = []
            gain = None
            if len(hist) >= 2 and hist[0].get('close'):
                gain = round((hist[-1]['close'] / hist[0]['close'] - 1) * 100, 1)
            trend = [a['daily'][str(d)] for d in days if str(d) in a['daily']]
            rows.append({
                'sector_name': name,
                'chg_pct': gain,
                'main_inflow': None,
                'leader_code': a['leader'][0] if a['leader'] else None,
                'leader_name': a['leader'][1] if a['leader'] else None,
                'limit_up_trend': trend or None,
                'lifecycle_stage': f"涨停{a['count']}家",
                'lifecycle_day': a['boards_max'],
            })
            if sum(1 for r in rows if r['chg_pct'] is not None) >= _PERIOD_LOOKBACK_LIMIT:
                break
        rows.sort(key=lambda r: (r['chg_pct'] is None, -(r['chg_pct'] or 0)))
        return rows[:_PERIOD_LOOKBACK_LIMIT]

    def _rank_review_events(
        self,
        rows: List[Any],
        prev_start: date,
        prev_end: date,
        limit: int = _PERIOD_REVIEW_LIMIT,
    ) -> List[Dict[str, Any]]:
        """上一周期热点回顾：已落库每日快讯事件按关键词强度降序取 Top N。"""
        scored: List[tuple] = []
        for r in rows:
            if r.event_type == 'calendar':
                continue  # 回顾只取快讯，日历前瞻行不参与
            if not (prev_start <= r.event_date <= prev_end):
                continue
            text = f"{r.title or ''} {r.summary or ''}"
            pos = sum(text.count(w) for w in _EVENT_POSITIVE_WORDS)
            neg = sum(text.count(w) for w in _EVENT_NEGATIVE_WORDS)
            scored.append((pos + neg, r))
        scored.sort(key=lambda t: (-t[0], t[1].event_date))
        return [
            {
                'event_date': str(r.event_date),
                'title': r.title,
                'source': r.source,
                'event_type': r.event_type,
                'sentiment': r.sentiment,
                'related_sectors': self._load_json(r.related_sectors, []),
                'related_stocks': self._load_json(r.related_stocks, []),
                'impact_label': '延续关注',
                'impact_magnitude': r.impact_magnitude,
                'summary': r.summary,
            }
            for _, r in scored[:limit]
        ]

    def generate_tomorrow_focus(self) -> Optional[Dict[str, Any]]:
        """基于当日梯队/板块生成明日重点（规则版 v1，不依赖 LLM）。

        关键事件 = 明日财经日历（importance≥2，噪音过滤，按时间排序 ≤8 条）；
        板块/个股 = 今日涨停池明细回溯（发酵延续 / 晋级候选）。
        """
        snapshot = self.repo.get_latest_snapshot(complete_only=True)
        ladder_rows = self.repo.list_ladder(days=1)
        pool_rows = self.repo.list_pool_details(None, 'limit_up')
        if snapshot is None:
            logger.warning("[明日重点] 无可用快照，跳过生成")
            return None

        ladder = ladder_rows[0] if ladder_rows else None
        for_date = snapshot.trade_date + timedelta(days=1)
        # 跳过周末
        while for_date.weekday() >= 5:
            for_date += timedelta(days=1)

        # 关键事件：明日财经日历
        manager = self._get_fetcher_manager()
        key_events: List[Dict[str, Any]] = []
        try:
            calendar = manager.get_economic_calendar(str(for_date)) or []
        except Exception as exc:
            logger.warning("[明日重点] 财经日历获取失败: %s", exc)
            calendar = []
        for ev in calendar:
            event = str(ev.get('event') or '').strip()
            if not event or (ev.get('importance') or 0) < 2:
                continue
            if _is_calendar_noise(event):
                continue
            region = str(ev.get('region') or '').strip()
            key_events.append({
                'time': ev.get('time'),
                'code': region or None,
                'title': f"[{region}] {event}" if region else event,
                'impact': _calendar_summary(ev),
                'sentiment': 'key' if _is_key_calendar_event(ev) else None,
            })
        key_events.sort(key=lambda e: e.get('time') or '')
        key_events = key_events[:_TOMORROW_KEY_EVENTS_LIMIT]

        stock_watch = []
        for row in sorted(
            pool_rows, key=lambda r: (r.boards or 0, r.seal_amount or 0), reverse=True,
        )[:5]:
            boards = row.boards or 0
            if boards < 1:
                continue
            industry = (row.industry or '').strip()
            seal_amount = row.seal_amount
            seal_label = f"{seal_amount / 1e8:.2f}亿" if seal_amount else '—'
            stock_watch.append({
                'code': row.stock_code,
                'name': row.stock_name,
                'concept': industry or None,
                'watch_type': 'upgrade',
                'label': (
                    f"晋级候选：{boards}板→{boards + 1}板"
                    if boards > 1 else "首板→2板候选"
                ),
                'reason': f"{boards}连板，封单 {seal_label}",
            })

        # 板块：今日涨停池行业聚集度（家数降序取前 4）
        industry_count: Counter = Counter(
            (r.industry or '').strip() for r in pool_rows if (r.industry or '').strip()
        )
        sector_watch = []
        for name, count in industry_count.most_common(4):
            sector_watch.append({
                'name': name,
                'status': 'continue' if count >= 3 else 'cold_probe',
                'reason': (
                    f"今日涨停 {count} 家，关注持续性"
                    if count >= 3 else f"今日涨停 {count} 家，观察是否转强"
                ),
            })

        ai_preview = (
            f"今日涨停 {snapshot.limit_up_count or 0} 家，"
            f"最高 {getattr(ladder, 'max_height', None) or 1} 板，"
            f"短线温度 {snapshot.sentiment_st if snapshot.sentiment_st is not None else '—'}，"
            f"趋势温度 {snapshot.sentiment_trend if snapshot.sentiment_trend is not None else '—'}；"
            f"明日重点关注 {(sector_watch[0]['name'] if sector_watch else '板块轮动')} 的持续性。"
        )

        row = self.repo.upsert_tomorrow({
            'for_date': for_date,
            'key_events': key_events,
            'sector_watch': sector_watch,
            'stock_watch': stock_watch,
            'ai_preview': ai_preview,
        })
        return {
            'for_date': str(row.for_date),
            'key_events': self._load_json(row.key_events, []),
            'sector_watch': self._load_json(row.sector_watch, []),
            'stock_watch': self._load_json(row.stock_watch, []),
            'ai_preview': row.ai_preview,
            'generated_at': str(row.generated_at),
        }

    # ------------------------------------------------------------------
    # 查询（读路径）
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # 阶段感知（盘中实时缓存 / 盘后自动补采 / 其余纯读库）
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_snapshot_trade_date() -> date:
        """快照归属交易日：交易日=当日；节假日=最近已收盘交易日。

        trading_calendar 不可用时 fail-open 回落自然日（与旧行为一致）。
        """
        today = date.today()
        try:
            if is_market_open('cn', today):
                return today
            return get_effective_trading_date('cn')
        except Exception as exc:
            logger.warning("[情绪采集] 归属交易日解析失败，回落当日: %s", exc)
            return today

    @staticmethod
    def _current_market_phase() -> MarketPhase:
        """推断 A 股当前交易阶段（trading_calendar 不可用时 UNKNOWN）。"""
        try:
            return infer_market_phase('cn')
        except Exception as exc:
            logger.warning("[情绪查询] 交易阶段推断失败: %s", exc)
            return MarketPhase.UNKNOWN

    def _get_realtime_block(self) -> Dict[str, Any]:
        """盘中实时块（60s TTL 缓存；未命中窗口内请求串行，防止并发惊群）。"""
        with _realtime_cache_lock:
            now = time.monotonic()
            if _realtime_cache['data'] is not None and now < _realtime_cache['expires_at']:
                return _realtime_cache['data']
            manager = self._get_fetcher_manager()
            block: Dict[str, Any] = {
                'indices': manager.get_main_indices(region='cn') or [],
                'market_stats': manager.get_market_stats(
                    purpose="market_sentiment_realtime"
                ) or None,
            }
            _realtime_cache['data'] = block
            _realtime_cache['expires_at'] = time.monotonic() + _REALTIME_TTL_SECONDS
            return block

    def _maybe_auto_collect(self, phase: MarketPhase) -> Optional[str]:
        """盘后自动补采当日快照（后台线程，按日幂等）。

        Returns:
            'collecting' 表示本次触发了后台采集；None 表示无需采集。
        """
        if phase is not MarketPhase.POSTMARKET:
            return None
        try:
            if get_market_now('cn').time() < _AUTO_COLLECT_MIN_LOCAL_TIME:
                return None     # 收盘缓冲：等涨跌停池定型
            trade_date = self._resolve_snapshot_trade_date()
        except Exception as exc:
            logger.warning("[情绪查询] 盘后补采前置检查失败: %s", exc)
            return None
        date_key = trade_date.isoformat()
        snapshot = self.repo.get_snapshot(trade_date)
        if snapshot is not None and snapshot.is_complete == 1:
            with _auto_collect_lock:
                _auto_collect_state[date_key] = 'done'
            return None
        with _auto_collect_lock:
            state = _auto_collect_state.get(date_key)
            if state in ('running', 'done'):
                return 'collecting' if state == 'running' else None
            _auto_collect_state[date_key] = 'running'

        def _run() -> None:
            try:
                self.collect_daily_snapshot(trade_date=trade_date)
                logger.info("[情绪查询] 盘后自动补采完成: %s", date_key)
            except Exception as exc:
                logger.warning("[情绪查询] 盘后自动补采失败 %s: %s", date_key, exc)
            finally:
                with _auto_collect_lock:
                    _auto_collect_state[date_key] = 'done'

        threading.Thread(
            target=_run, name="sentiment-auto-collect", daemon=True
        ).start()
        return 'collecting'

    # ------------------------------------------------------------------
    # 历史回填（一次性补采，字段受限）
    # ------------------------------------------------------------------

    def _recent_trading_dates(self, count: int) -> List[date]:
        """自最近归属交易日起往前列出 N 个交易日（新→旧）。

        交易日判断走 exchange-calendars；fail-open 时按自然日收录。
        """
        dates: List[date] = []
        cursor = self._resolve_snapshot_trade_date()
        guard = 0
        while len(dates) < count and guard < count * 5 + 40:
            guard += 1
            try:
                if is_market_open('cn', cursor):
                    dates.append(cursor)
            except Exception:
                dates.append(cursor)
            cursor -= timedelta(days=1)
        return dates

    def _fetch_index_history(
        self, manager: Any, dates: List[date]
    ) -> Dict[str, Dict[date, Dict[str, Optional[float]]]]:
        """拉取回填窗口内各指数日线（close/amount/涨跌幅），按日期对齐。

        日线 fallback 源（新浪/腾讯）普遍无成交额列；沪市成交额用
        tushare index_daily 补齐（深市通常可由东财链路给出）。
        """
        start = min(dates) - timedelta(days=14)     # 多取两周作前收盘基数
        end = max(dates)
        history: Dict[str, Dict[date, Dict[str, Optional[float]]]] = {}
        for code in _BACKFILL_INDEX_CODES:
            try:
                df, _source = manager.get_daily_data(
                    code, start_date=start.isoformat(), end_date=end.isoformat()
                )
            except Exception as exc:
                logger.warning("[情绪回填] %s 日线获取失败: %s", code, exc)
                continue
            if df is None or df.empty or 'date' not in getattr(df, 'columns', []):
                continue
            by_date: Dict[date, Dict[str, Optional[float]]] = {}
            prev_close: Optional[float] = None
            try:
                ordered = df.sort_values('date')
            except Exception:
                ordered = df
            for _, row in ordered.iterrows():
                try:
                    day = date.fromisoformat(str(row.get('date', ''))[:10])
                except ValueError:
                    continue
                close = _to_float(row.get('close'))
                chg_pct = None
                if close is not None and prev_close:
                    chg_pct = round((close - prev_close) / prev_close * 100, 3)
                by_date[day] = {
                    'close': close,
                    'chg_pct': chg_pct,
                    'amount': _to_float(row.get('amount')),
                }
                if close is not None:
                    prev_close = close
            history[code] = by_date
        return history

    def _build_backfill_indices(
        self,
        hist: Dict[str, Dict[date, Dict[str, Optional[float]]]],
        trade_date: date,
    ) -> Dict[str, Any]:
        """从日线历史提取该日指数字段（口径与 _parse_indices 一致）。"""
        result: Dict[str, Any] = {}
        for code, prefix in _BACKFILL_INDEX_CODES.items():
            row = hist.get(code, {}).get(trade_date)
            if not row:
                continue
            amount_yi = (
                round(row['amount'] / 1e8, 2) if row['amount'] is not None else None
            )
            if prefix == 'sh':
                result['sh_close'] = row['close']
                result['sh_chg_pct'] = row['chg_pct']
                result['sh_amount'] = amount_yi
            elif prefix == 'sz':
                result['sz_amount'] = amount_yi
            elif prefix == 'hs300':
                result['hs300_close'] = row['close']
                result['hs300_chg_pct'] = row['chg_pct']
            elif prefix == 'sh50':
                result['sh50_chg_pct'] = row['chg_pct']
            elif prefix == 'chinext':
                result['chinext_chg_pct'] = row['chg_pct']
        return result

    def _fetch_pools_for_date(
        self, manager: Any, trade_date: date
    ) -> Dict[str, List[Dict[str, Any]]]:
        """按日期拉三类池（manager 池接口原生支持 date），按代码去重。"""
        date_str = trade_date.strftime('%Y%m%d')
        pools: Dict[str, List[Dict[str, Any]]] = {}
        for pool_type, fetch in (
            ('limit_up', lambda: manager.get_limit_up_pool(date=date_str, n=_LIMIT_POOL_FETCH_N)),
            ('limit_down', lambda: manager.get_limit_down_pool(date=date_str, n=_LIMIT_POOL_FETCH_N)),
            ('blown', lambda: manager.get_blown_pool(date=date_str, n=_LIMIT_POOL_FETCH_N)),
        ):
            raw: List[Dict[str, Any]] = []
            try:
                raw = fetch() or []
            except Exception as exc:
                logger.warning("[情绪回填] %s@%s 获取失败: %s", pool_type, date_str, exc)
            deduped: List[Dict[str, Any]] = []
            seen: set = set()
            for item in raw:
                code = str(item.get('code') or '').strip()
                if not code or code in seen:
                    continue
                seen.add(code)
                deduped.append(item)
            pools[pool_type] = deduped
        return pools

    def backfill_recent_snapshots(self, lookback_days: int = 5) -> Dict[str, Any]:
        """回填最近 N 个交易日快照（一次性历史补采，字段受限）。

        历史可得：指数点位/涨跌、沪深成交额（指数日线口径）、三类池/梯队/炸板率。
        涨跌家数与外盘无历史免费源 → 置空 → sentiment_st/trend 为 None。
        已有快照且量能齐全（is_complete=1 且 total_amount 非空）的日期跳过；
        数据源限流导致量能缺失时，重跑本方法可自动补齐。交易日由日历推导。
        """
        manager = self._get_fetcher_manager()
        dates = self._recent_trading_dates(lookback_days)
        if not dates:
            return {'backfilled': [], 'skipped': [], 'failed': [],
                    'reason': 'no_trading_dates'}
        hist = self._fetch_index_history(manager, dates)
        sh_hist = hist.get('sh000001')
        if sh_hist and any(
            (sh_hist.get(d) or {}).get('amount') is None for d in dates
        ):
            for day, amount in _fetch_sh_amount_yi_by_date(dates).items():
                if day in sh_hist and sh_hist[day]['amount'] is None:
                    sh_hist[day]['amount'] = amount
        backfilled: List[str] = []
        skipped: List[str] = []
        failed: List[Dict[str, str]] = []
        for trade_date in sorted(dates):    # 旧→新，保证量能环比基数
            date_key = trade_date.isoformat()
            existing = self.repo.get_snapshot(trade_date)
            if (
                existing is not None
                and existing.is_complete == 1
                and existing.total_amount is not None
            ):
                skipped.append(date_key)
                continue
            try:
                indices = self._build_backfill_indices(hist, trade_date)
                sh_amount = indices.get('sh_amount')
                sz_amount = indices.get('sz_amount')
                total_amount = (
                    round(sh_amount + sz_amount, 2)
                    if sh_amount is not None and sz_amount is not None else None
                )
                prev_snapshot = self.repo.get_latest_snapshot(exclude_date=trade_date)
                amount_vs_prev = None
                if (
                    total_amount is not None
                    and prev_snapshot is not None
                    and prev_snapshot.total_amount
                ):
                    amount_vs_prev = round(
                        (total_amount - prev_snapshot.total_amount)
                        / prev_snapshot.total_amount * 100, 1
                    )
                pools = self._fetch_pools_for_date(manager, trade_date)
                pool = pools.get('limit_up') or []
                blown_count = len(pools.get('blown') or [])
                limit_up_total = len(pool)
                blown_rate = None
                if limit_up_total + blown_count > 0:
                    blown_rate = round(
                        blown_count / (limit_up_total + blown_count) * 100, 1
                    )
                ladder = aggregate_ladder(
                    pool, prev_snapshot.limit_up_count if prev_snapshot else None
                )
                self.repo.upsert_daily_snapshot({
                    'trade_date': trade_date,
                    'total_amount': total_amount,
                    'amount_vs_prev': amount_vs_prev,
                    'sh_amount': sh_amount,
                    'sz_amount': sz_amount,
                    'up_count': None,           # 历史涨跌家数无免费源
                    'down_count': None,
                    'flat_count': None,
                    'limit_up_count': limit_up_total or None,
                    'limit_down_count': len(pools.get('limit_down') or []) or None,
                    'blown_count': blown_count or None,
                    'blown_rate': blown_rate,
                    'sentiment_st': None,       # 依赖涨跌家数，回填行置空
                    'sentiment_trend': None,
                    'main_inflow': None,
                    'north_inflow': None,
                    'hs300_close': indices.get('hs300_close'),
                    'hs300_chg_pct': indices.get('hs300_chg_pct'),
                    'sh50_chg_pct': indices.get('sh50_chg_pct'),
                    'chinext_chg_pct': indices.get('chinext_chg_pct'),
                    'sh_close': indices.get('sh_close'),
                    'sh_chg_pct': indices.get('sh_chg_pct'),
                    'new_high_60d': None,
                    'new_low_60d': None,
                    'overseas_summary': None,
                    'is_complete': 1,
                })
                if pool:
                    self.repo.upsert_ladder_snapshot({'trade_date': trade_date, **ladder})
                for pool_type, rows in pools.items():
                    if rows:
                        self.repo.refresh_pool_details(
                            trade_date, pool_type,
                            [self._pool_row_to_fields(item) for item in rows],
                        )
                backfilled.append(date_key)
            except Exception as exc:
                logger.warning("[情绪回填] %s 失败: %s", date_key, exc)
                failed.append({'trade_date': date_key, 'error': str(exc)})
        return {'backfilled': backfilled, 'skipped': skipped, 'failed': failed}

    def get_overview(self, realtime: bool = False) -> Dict[str, Any]:
        """今日面板：快照表优先；数据来源按 A 股交易阶段自动决定。

        - 盘中/午休/收盘竞价：附实时块（60s TTL 缓存）
        - 盘后：读库；当日快照缺失时后台自动补采（幂等）
        - 盘前/节假日：纯读库，不发外部请求
        - realtime=True：显式强制实时，任何阶段直接拉源（向后兼容）
        """
        phase = self._current_market_phase()
        degraded: List[str] = []
        snapshot = self.repo.get_latest_snapshot()
        data: Dict[str, Any] = {
            'trade_date': str(snapshot.trade_date) if snapshot else str(date.today()),
            'is_complete': bool(snapshot and snapshot.is_complete == 1),
            'market_phase': phase.value,
            'temperature': {
                'st': snapshot.sentiment_st if snapshot else None,
                'trend': snapshot.sentiment_trend if snapshot else None,
            },
            'amount': {
                'total': snapshot.total_amount if snapshot else None,
                'sh': snapshot.sh_amount if snapshot else None,
                'sz': snapshot.sz_amount if snapshot else None,
                'vs_prev_pct': snapshot.amount_vs_prev if snapshot else None,
            },
            'advance_decline': {
                'up': snapshot.up_count if snapshot else None,
                'down': snapshot.down_count if snapshot else None,
                'flat': snapshot.flat_count if snapshot else None,
                'limit_up': snapshot.limit_up_count if snapshot else None,
                'limit_down': snapshot.limit_down_count if snapshot else None,
                'blown_rate': snapshot.blown_rate if snapshot else None,
            },
            'inflow': {
                'main': snapshot.main_inflow if snapshot else None,
                'north': snapshot.north_inflow if snapshot else None,
            },
            'indices': {
                'hs300_close': snapshot.hs300_close if snapshot else None,
                'hs300_chg_pct': snapshot.hs300_chg_pct if snapshot else None,
                'sh50_chg_pct': snapshot.sh50_chg_pct if snapshot else None,
                'chinext_chg_pct': snapshot.chinext_chg_pct if snapshot else None,
                'sh_close': snapshot.sh_close if snapshot else None,
                'sh_chg_pct': snapshot.sh_chg_pct if snapshot else None,
            },
            'new_high_60d': snapshot.new_high_60d if snapshot else None,
            'new_low_60d': snapshot.new_low_60d if snapshot else None,
            'overseas': (
                self._load_json(snapshot.overseas_summary, None) if snapshot else None
            ),
            'realtime': None,
        }
        if snapshot is None:
            degraded.append('snapshot')

        if realtime or phase in _REALTIME_PHASES:
            label = "显式实时" if realtime else "盘中实时"
            try:
                data['realtime'] = self._get_realtime_block()
            except Exception as exc:
                logger.warning("[情绪查询] %s获取失败: %s", label, exc)
                degraded.append('realtime')
        elif phase is MarketPhase.POSTMARKET:
            # 盘后：读库为主；当日快照缺失时后台自动补采（不阻塞响应）
            if self._maybe_auto_collect(phase) == 'collecting':
                degraded.append('snapshot_collecting')
        # 盘前 / 节假日 / UNKNOWN：纯读库，不发外部请求

        data['degraded'] = degraded
        return data

    def get_trend(self, days: int = 30) -> List[Dict[str, Any]]:
        rows = self.repo.list_snapshots(days=days, complete_only=True)
        return [
            {
                'trade_date': str(r.trade_date),
                'sentiment_st': r.sentiment_st,
                'sentiment_trend': r.sentiment_trend,
                'total_amount': r.total_amount,
                'up_count': r.up_count,
                'down_count': r.down_count,
                'limit_up_count': r.limit_up_count,
                'limit_down_count': r.limit_down_count,
                'hs300_chg_pct': r.hs300_chg_pct,
            }
            for r in rows
        ]

    def get_ladder_trend(self, days: int = 5) -> List[Dict[str, Any]]:
        rows = self.repo.list_ladder(days=days)
        return [
            {
                'trade_date': str(r.trade_date),
                'height_1': r.height_1,
                'height_2': r.height_2,
                'height_3': r.height_3,
                'height_4': r.height_4,
                'height_5plus': r.height_5plus,
                'max_height': r.max_height,
                'max_height_code': r.max_height_code,
                'max_height_name': r.max_height_name,
                'ladder_complete': r.ladder_complete,
                'first_seal_dist': self._load_json(r.first_seal_dist, None),
                'sector_dist': self._load_json(r.sector_dist, None),
                'prev_limit_up_total': r.prev_limit_up_total,
                'prev_limit_up_again': r.prev_limit_up_again,
                'prev_limit_up_blown': r.prev_limit_up_blown,
                'prev_limit_up_down': r.prev_limit_up_down,
            }
            for r in rows
        ]

    _POOL_BOARD_FIELD = {
        'limit_up': 'consecutive_boards',
        'limit_down': 'continuous_down_days',
    }

    @classmethod
    def _pool_record_to_dict(
        cls, row: Any, pool_type: str
    ) -> Dict[str, Any]:
        """池明细快照行 → 数据契约 dict（字段名与 data_provider 契约对齐）。"""
        result: Dict[str, Any] = {
            'code': row.stock_code,
            'name': row.stock_name,
            'change_pct': row.chg_pct,
            'price': row.price,
            'amount': row.amount,
            'turnover_rate': row.turnover_rate,
            'seal_amount': row.seal_amount,
            'first_limit_time': row.first_limit_time or '',
            'last_limit_time': row.last_limit_time or '',
            'break_count': row.break_count,
            'limit_stat': row.limit_stat or '',
            'industry': row.industry or '',
        }
        board_field = cls._POOL_BOARD_FIELD.get(pool_type)
        if board_field:
            result[board_field] = row.boards
        return result

    def get_ladder_today(self, pool_type: str = 'limit_up') -> Dict[str, Any]:
        """今日池详情：当日快照优先；盘中/缺当日数据时实时拉源兜底。

        读取顺序：
        1. 当日 (trade_date=today, pool_type) 明细快照 → 直接读库；
        2. 无当日数据（盘中或未采集）→ 实时拉源；
        3. 实时也为空（非交易日/源失败）→ 回退该池最近一个有数据的交易日。
        """
        trend = self.get_ladder_trend(days=1)
        snapshot = trend[-1] if trend else None
        pool: List[Dict[str, Any]] = []
        degraded: List[str] = []
        pool_source = 'snapshot'

        rows = self.repo.list_pool_details(
            trade_date=date.today(), pool_type=pool_type
        )
        if rows:
            pool = [self._pool_record_to_dict(r, pool_type) for r in rows]
        else:
            pool_source = 'realtime'
            fetch_map = {
                'limit_up': lambda m: m.get_limit_up_pool(n=50),
                'limit_down': lambda m: m.get_limit_down_pool(n=50),
                'blown': lambda m: m.get_blown_pool(n=50),
            }
            try:
                pool = fetch_map[pool_type](self._get_fetcher_manager()) or []
            except Exception as exc:
                logger.warning("[情绪查询] %s获取失败: %s", pool_type, exc)
                degraded.append(f'{pool_type}_pool')
            if not pool:
                rows = self.repo.list_pool_details(trade_date=None, pool_type=pool_type)
                if rows:
                    pool_source = 'snapshot_prev'
                    pool = [self._pool_record_to_dict(r, pool_type) for r in rows]

        return {
            'snapshot': snapshot,
            'pool': pool,
            'pool_type': pool_type,
            'pool_source': pool_source,
            'degraded': degraded,
        }

    def get_focus(self, scope: str) -> Dict[str, Any]:
        """市场聚焦：事件（前瞻日历 + 近期快讯回顾）+ 板块/个股（上一周期回溯聚合）。

        周聚焦 = 未来 7 天滚动窗口（前瞻仅日历事件；回顾 = 近 7 天快讯 Top N）；
        月聚焦 = 本月 1 日→月末。
        """
        today = date.today()
        if scope == 'week':
            period_start = today
            prev_start = today - timedelta(days=7)
            prev_end = today
        else:
            period_start = today.replace(day=1)
            prev_end = period_start - timedelta(days=1)
            prev_start = prev_end.replace(day=1)

        forward_rows = self.repo.list_focus_events(
            scope, days=35, since_date=period_start, event_type='calendar',
        )
        forward_rows = sorted(
            forward_rows, key=lambda r: (r.event_date, r.summary or ''),
        )
        review_rows = self.repo.list_focus_events('week', days=35, since_date=prev_start)
        events = [
            {
                'event_date': str(r.event_date),
                'title': r.title,
                'source': r.source,
                'event_type': r.event_type,
                'sentiment': r.sentiment,
                'related_sectors': self._load_json(r.related_sectors, []),
                'related_stocks': self._load_json(r.related_stocks, []),
                'impact_label': r.impact_label,
                'impact_magnitude': r.impact_magnitude,
                'summary': r.summary,
            }
            for r in forward_rows
        ]
        review_events = self._rank_review_events(review_rows, prev_start, prev_end)

        stocks = self.repo.list_latest_focus_stocks(scope)
        sectors = self.repo.list_latest_focus_sectors(scope)
        return {
            'scope': scope,
            'events': events,
            'review_events': review_events,
            'stocks': [
                {
                    'stock_code': r.stock_code,
                    'stock_name': r.stock_name,
                    'concept_tags': self._load_json(r.concept_tags, []),
                    'boards': r.boards,
                    'reason': r.reason,
                    'chg_pct': r.chg_pct,
                    'turnover_rate': r.turnover_rate,
                    'main_inflow': r.main_inflow,
                    'dragon_tiger': r.dragon_tiger,
                    'inst_buy': r.inst_buy,
                }
                for r in stocks
            ],
            'sectors': [
                {
                    'sector_name': r.sector_name,
                    'chg_pct': r.chg_pct,
                    'main_inflow': r.main_inflow,
                    'leader_code': r.leader_code,
                    'leader_name': r.leader_name,
                    'limit_up_trend': self._load_json(r.limit_up_trend, None),
                    'lifecycle_stage': r.lifecycle_stage,
                    'lifecycle_day': r.lifecycle_day,
                }
                for r in sectors
            ],
            'degraded': (
                [] if events or stocks or sectors else ['focus_data']
            ),
        }

    def get_tomorrow(self) -> Optional[Dict[str, Any]]:
        row = self.repo.get_latest_tomorrow()
        if row is None:
            return None
        return {
            'for_date': str(row.for_date),
            'key_events': self._load_json(row.key_events, []),
            'sector_watch': self._load_json(row.sector_watch, []),
            'stock_watch': self._load_json(row.stock_watch, []),
            'ai_preview': row.ai_preview,
            'generated_at': str(row.generated_at),
        }

    # ------------------------------------------------------------------

    @staticmethod
    def _load_json(value: Any, default: Any) -> Any:
        if value is None:
            return default
        if isinstance(value, (list, dict)):
            return value
        if isinstance(value, str):
            try:
                loaded = json.loads(value)
            except (ValueError, TypeError):
                return default
            return default if loaded is None else loaded  # 'null' 归位 default
        return default
