# -*- coding: utf-8 -*-
"""ThsFetcher（同花顺 Financial-API）离线单测：契约、错误码映射、代码转换、池归一化。"""

import importlib.util
import json
import os
import sys
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from tests.litellm_stub import ensure_litellm_stub

ensure_litellm_stub()

try:
    json_repair_available = importlib.util.find_spec("json_repair") is not None
except ValueError:
    json_repair_available = "json_repair" in sys.modules

if not json_repair_available and "json_repair" not in sys.modules:
    sys.modules["json_repair"] = MagicMock()

import data_provider.ths_fetcher as ths_module
from data_provider.base import DataFetchError, RateLimitError
from data_provider.ths_fetcher import (
    ThsFetcher,
    _ThsAuthError,
    _ThsHttpClient,
    _resolve_ths_base_url,
)


def _response(status_code=200, body=None):
    return MagicMock(status_code=status_code, text=json.dumps(body or {}))


def _ok_response(items):
    return _response(body={"code": 0, "message": "ok", "data": {"item": items}})


def _make_fetcher(api_key="demo-key", api_url_env=None):
    """构造带/不带 key 的 ThsFetcher，并隔离 URL 环境变量。"""
    config = SimpleNamespace(
        hithink_finance_api_key=api_key,
        hithink_finance_api_url=None,
    )
    env = {k: v for k, v in os.environ.items() if k != "HITHINK_FINANCE_API_URL"}
    if api_url_env:
        env["HITHINK_FINANCE_API_URL"] = api_url_env
    with patch("data_provider.ths_fetcher.get_config", return_value=config), \
            patch.dict("os.environ", env, clear=True):
        return ThsFetcher()


class TestThsHttpClient(unittest.TestCase):
    """响应信封解析与错误码映射。"""

    def test_success_returns_items_with_api_key_header(self) -> None:
        client = _ThsHttpClient(api_key="demo-key", timeout=15)
        response = _ok_response([{"code": "600519", "close": 1688.0}])

        with patch("data_provider.ths_fetcher.requests.get", return_value=response) as get_mock:
            items = client.request("/api/a-share/prices/snapshot", {"thscodes": "600519.SH"})

        get_mock.assert_called_once_with(
            "https://fuyao.aicubes.cn/api/a-share/prices/snapshot",
            params={"thscodes": "600519.SH"},
            headers={"X-api-key": "demo-key"},
            timeout=15,
        )
        self.assertEqual(items, [{"code": "600519", "close": 1688.0}])

    def test_rate_limit_code_raises_rate_limit_error(self) -> None:
        client = _ThsHttpClient(api_key="demo-key")
        with patch(
            "data_provider.ths_fetcher.requests.get",
            return_value=_response(body={"code": 4001, "message": "qps exceeded"}),
        ):
            with self.assertRaises(RateLimitError):
                client.request("/api/a-share/prices/snapshot")

    def test_auth_code_raises_auth_error(self) -> None:
        client = _ThsHttpClient(api_key="demo-key")
        with patch(
            "data_provider.ths_fetcher.requests.get",
            return_value=_response(body={"code": 2001, "message": "unauthorized"}),
        ):
            with self.assertRaises(_ThsAuthError):
                client.request("/api/a-share/prices/snapshot")

    def test_no_data_codes_return_empty_list(self) -> None:
        client = _ThsHttpClient(api_key="demo-key")
        for code in (3001, 3002, 3004):
            with patch(
                "data_provider.ths_fetcher.requests.get",
                return_value=_response(body={"code": code, "message": "not ready"}),
            ):
                self.assertEqual(client.request("/api/a-share/prices/snapshot"), [])

    def test_business_error_raises_data_fetch_error(self) -> None:
        client = _ThsHttpClient(api_key="demo-key")
        with patch(
            "data_provider.ths_fetcher.requests.get",
            return_value=_response(body={"code": 9999, "message": "boom"}),
        ):
            with self.assertRaises(DataFetchError):
                client.request("/api/a-share/prices/snapshot")

    def test_http_error_raises_data_fetch_error(self) -> None:
        client = _ThsHttpClient(api_key="demo-key")
        with patch(
            "data_provider.ths_fetcher.requests.get",
            return_value=MagicMock(status_code=500, text="oops"),
        ):
            with self.assertRaises(DataFetchError):
                client.request("/api/a-share/prices/snapshot")


class TestResolveThsBaseUrl(unittest.TestCase):
    """``HITHINK_FINANCE_API_URL`` 环境变量解析与校验。"""

    def test_unset_returns_none(self) -> None:
        env = {k: v for k, v in os.environ.items() if k != "HITHINK_FINANCE_API_URL"}
        with patch.dict("os.environ", env, clear=True):
            self.assertIsNone(_resolve_ths_base_url())

    def test_whitespace_returns_none(self) -> None:
        with patch.dict("os.environ", {"HITHINK_FINANCE_API_URL": "   "}):
            self.assertIsNone(_resolve_ths_base_url())

    def test_valid_url_returned_stripped(self) -> None:
        with patch.dict("os.environ", {"HITHINK_FINANCE_API_URL": "  https://gw.example.com  "}):
            self.assertEqual(_resolve_ths_base_url(), "https://gw.example.com")

    def test_missing_schema_raises_value_error(self) -> None:
        with patch.dict("os.environ", {"HITHINK_FINANCE_API_URL": "gw.example.com"}):
            with self.assertRaises(ValueError):
                _resolve_ths_base_url()


class TestThsFetcherInit(unittest.TestCase):
    """初始化 gating、可用性与动态优先级。"""

    def test_init_builds_client_when_key_present(self) -> None:
        fetcher = _make_fetcher()
        self.assertIsInstance(fetcher._client, _ThsHttpClient)
        self.assertTrue(fetcher.is_available())
        self.assertEqual(fetcher.priority, 2)

    def test_init_without_key_is_unavailable(self) -> None:
        fetcher = _make_fetcher(api_key="")
        self.assertIsNone(fetcher._client)
        self.assertFalse(fetcher.is_available())

    def test_custom_url_env_used(self) -> None:
        fetcher = _make_fetcher(api_url_env="https://gw.example.com")
        self.assertEqual(fetcher._client._base_url, "https://gw.example.com")

    def test_auth_failure_marks_unavailable(self) -> None:
        fetcher = _make_fetcher()
        self.assertTrue(fetcher.is_available())
        with patch(
            "data_provider.ths_fetcher.requests.get",
            return_value=_response(body={"code": 2003, "message": "forbidden"}),
        ):
            with self.assertRaises(DataFetchError):
                fetcher._request_items("/api/a-share/prices/snapshot", {})
        self.assertFalse(fetcher.is_available())


class TestCodeConversion(unittest.TestCase):
    """内部裸代码 → thscode；非 A 股前置拒绝。"""

    def test_to_ths_code_matrix(self) -> None:
        cases = {
            "600519": "600519.SH",
            "000001": "000001.SZ",
            "300750": "300750.SZ",
            "510300": "510300.SH",
            "920748": "920748.BJ",
            "830799": "830799.BJ",
            "600519.SH": "600519.SH",
        }
        for raw, expected in cases.items():
            self.assertEqual(ThsFetcher._to_ths_code(raw), expected, raw)

    def test_non_cn_codes_rejected(self) -> None:
        for code in ("hk00700", "AAPL", "7203.T"):
            with self.assertRaises(DataFetchError, msg=code):
                ThsFetcher._ensure_cn_stock(code)
            with self.assertRaises(DataFetchError, msg=code):
                ThsFetcher._to_ths_code(code)


class TestNormalizeData(unittest.TestCase):
    """ms 时间戳、pct_chg 推导与列裁剪。"""

    def test_normalize_converts_and_derives(self) -> None:
        fetcher = _make_fetcher()
        # 真实返回列名（2026-09-25 联调核对）：date_ms/*_price/turnover
        base = datetime(2026, 9, 24, 0, 0).timestamp() * 1000  # 本机时区无关性：仅验证转换不报错与列结构
        df = ths_module.pd.DataFrame(
            [
                {"date_ms": base, "open_price": 10.0, "high_price": 11.0, "low_price": 9.5, "close_price": 10.5, "volume": 100, "turnover": 1000},
                {"date_ms": base + 86400000, "open_price": 10.5, "high_price": 12.0, "low_price": 10.4, "close_price": 11.55, "volume": 120, "turnover": 1300},
            ]
        )
        out = fetcher._normalize_data(df, "600519")

        self.assertEqual(out["code"].tolist(), ["600519", "600519"])
        # 真实列名映射：turnover → amount（单位已核对：股/元，透传）
        self.assertEqual(out["amount"].tolist(), [1000, 1300])
        self.assertNotIn("turnover", out.columns)
        # pct_chg 由相邻收盘价推导：第二行 (11.55/10.5 - 1) * 100
        self.assertAlmostEqual(out["pct_chg"].iloc[1], (11.55 / 10.5 - 1) * 100, places=6)
        self.assertTrue(ths_module.pd.isna(out["pct_chg"].iloc[0]))
        # 列 = code + STANDARD_COLUMNS 交集，且顺序一致
        expected = ["code"] + [c for c in ths_module.STANDARD_COLUMNS if c in out.columns]
        self.assertEqual(list(out.columns), expected)

    def test_normalize_missing_date_column_raises(self) -> None:
        fetcher = _make_fetcher()
        df = ths_module.pd.DataFrame([{"close": 10.0}])
        with self.assertRaises(DataFetchError):
            fetcher._normalize_data(df, "600519")


class TestFetchRawData(unittest.TestCase):
    """历史日 K 分页拉取。"""

    def test_pagination_accumulates_pages(self) -> None:
        fetcher = _make_fetcher()
        page = [
            {"date": 1758729600000 + i * 86400000, "close": 10.0 + i}
            for i in range(2)
        ]
        calls = []

        def fake_request(path, params):
            calls.append((path, dict(params)))
            if params["offset"] == 0:
                return [dict(row) for row in page]
            return [dict(page[0])]

        with patch.object(fetcher, "_request_items", side_effect=fake_request), \
                patch.object(ths_module, "_HISTORY_PAGE_SIZE", 2):
            df = fetcher._fetch_raw_data("600519", "2026-09-01", "2026-09-25")

        self.assertEqual(len(df), 3)
        self.assertEqual(calls[0][1]["offset"], 0)
        self.assertEqual(calls[1][1]["offset"], 2)
        self.assertEqual(calls[0][1]["thscode"], "600519.SH")
        self.assertEqual(calls[0][1]["interval"], "1d")
        self.assertEqual(calls[0][1]["adjust"], "forward")

    def test_empty_window_returns_empty_frame(self) -> None:
        fetcher = _make_fetcher()
        with patch.object(fetcher, "_request_items", return_value=[]):
            df = fetcher._fetch_raw_data("600519", "2026-09-01", "2026-09-25")
        self.assertTrue(df.empty)

    def test_window_clamped_to_ten_years(self) -> None:
        start_ms, end_ms = ThsFetcher._history_window_ms("2010-01-01", "2026-09-25")
        span_days = (end_ms - start_ms) / 86400000.0
        self.assertLessEqual(span_days, 10 * 365 + 1)


class TestPoolHooks(unittest.TestCase):
    """涨/跌/炸板池归一化到统一契约。"""

    def test_limit_up_pool_contract(self) -> None:
        fetcher = _make_fetcher()
        items = [
            {
                "code": "600519", "name": "贵州茅台", "change_pct": 10.0, "price": 100.0,
                "amount": 123456.0, "turnover_rate": 5.5, "seal_money": 9.9e8,
                "first_limit_time": "09:25", "last_limit_time": "09:25",
                "open_times": 0, "limit_stat": "2/2", "industry": "白酒",
                "continue_day_cnt": 3,
            }
        ]
        with patch.object(fetcher, "_request_items", return_value=items) as req_mock:
            rows = fetcher.get_limit_up_pool(date="20260925", n=10)

        self.assertEqual(rows[0]["code"], "600519")
        self.assertEqual(rows[0]["name"], "贵州茅台")
        self.assertEqual(rows[0]["first_limit_time"], "092500")
        self.assertEqual(rows[0]["consecutive_boards"], 3)
        self.assertNotIn("continuous_down_days", rows[0])
        # 日期参数归一为 YYYY-MM-DD
        self.assertEqual(req_mock.call_args[0][1]["date"], "2026-09-25")
        self.assertEqual(req_mock.call_args[0][1]["size"], 10)

    def test_limit_down_pool_boards_field(self) -> None:
        fetcher = _make_fetcher()
        items = [{"code": "000001", "name": "X", "first_limit_time": "14:30:05", "continue_day_cnt": 2}]
        with patch.object(fetcher, "_request_items", return_value=items):
            rows = fetcher.get_limit_down_pool()
        self.assertEqual(rows[0]["continuous_down_days"], 2)
        self.assertEqual(rows[0]["first_limit_time"], "143005")

    def test_blown_pool_has_no_boards_field(self) -> None:
        fetcher = _make_fetcher()
        items = [{"code": "300001", "name": "Y", "open_times": 2}]
        with patch.object(fetcher, "_request_items", return_value=items):
            rows = fetcher.get_blown_pool()
        self.assertNotIn("consecutive_boards", rows[0])
        self.assertNotIn("continuous_down_days", rows[0])
        self.assertEqual(rows[0]["break_count"], 2)

    def test_empty_items_return_none(self) -> None:
        fetcher = _make_fetcher()
        with patch.object(fetcher, "_request_items", return_value=[]):
            self.assertIsNone(fetcher.get_limit_up_pool())

    def test_exception_returns_none(self) -> None:
        fetcher = _make_fetcher()
        with patch.object(fetcher, "_request_items", side_effect=DataFetchError("boom")):
            self.assertIsNone(fetcher.get_limit_down_pool())

    def test_without_client_returns_none(self) -> None:
        fetcher = _make_fetcher(api_key="")
        self.assertIsNone(fetcher.get_limit_up_pool())

    def test_n_truncation(self) -> None:
        fetcher = _make_fetcher()
        items = [{"code": str(i).zfill(6), "name": f"s{i}", "continue_day_cnt": 1} for i in range(5)]
        with patch.object(fetcher, "_request_items", return_value=items):
            rows = fetcher.get_limit_up_pool(n=3)
        self.assertEqual(len(rows), 3)

    def test_pool_date_normalization(self) -> None:
        self.assertIsNone(ThsFetcher._normalize_pool_date(None))
        self.assertIsNone(ThsFetcher._normalize_pool_date("  "))
        self.assertEqual(ThsFetcher._normalize_pool_date("20260925"), "2026-09-25")
        self.assertEqual(ThsFetcher._normalize_pool_date("2026-09-25"), "2026-09-25")


class TestMainIndices(unittest.TestCase):
    """指数快照归一化到契约字段（情绪页优先源）。"""

    def test_main_indices_contract(self) -> None:
        fetcher = _make_fetcher()
        items = [
            {"thscode": "000001.SH", "last_price": 3888.37, "price_change": -48.15,
             "price_change_ratio_pct": -1.223162, "volume": 43853041000, "turnover": 783613000000},
            {"thscode": "399106.SZ", "last_price": 2476.0749, "price_change": -49.8486,
             "price_change_ratio_pct": -1.97348, "volume": 52625266000, "turnover": 869744360000},
            {"thscode": "XXX999.TI", "last_price": 1.0},  # 未知代码忽略
        ]
        with patch.object(fetcher, "_request_items", return_value=items) as req_mock:
            rows = fetcher.get_main_indices(region="cn")

        self.assertEqual(rows[0]["code"], "000001")
        self.assertEqual(rows[0]["name"], "上证指数")
        self.assertEqual(rows[0]["current"], 3888.37)
        self.assertAlmostEqual(rows[0]["change_pct"], -1.223162)
        # amount ← turnover，单位元（2026-09-25 联调核对：上证指数=沪市总额）
        self.assertEqual(rows[0]["amount"], 783613000000)
        self.assertEqual(rows[1]["name"], "深证综指")
        self.assertEqual(len(rows), 2)
        self.assertEqual(req_mock.call_args[0][0], "/api/a-share-index/prices/snapshot")
        self.assertIn("000300.SH", req_mock.call_args[0][1]["thscodes"])

    def test_main_indices_non_cn_returns_none(self) -> None:
        fetcher = _make_fetcher()
        self.assertIsNone(fetcher.get_main_indices(region="us"))

    def test_main_indices_without_client_returns_none(self) -> None:
        fetcher = _make_fetcher(api_key="")
        self.assertIsNone(fetcher.get_main_indices(region="cn"))

    def test_main_indices_failure_returns_none(self) -> None:
        fetcher = _make_fetcher()
        with patch.object(fetcher, "_request_items", side_effect=DataFetchError("boom")):
            self.assertIsNone(fetcher.get_main_indices(region="cn"))


class TestMetaSearch(unittest.TestCase):
    """meta 补名辅助通道。"""

    def test_search_returns_items(self) -> None:
        fetcher = _make_fetcher()
        with patch.object(
            fetcher, "_request_items", return_value=[{"code": "600519", "name": "贵州茅台"}]
        ) as req_mock:
            rows = fetcher._meta_search("茅台")
        self.assertEqual(rows[0]["name"], "贵州茅台")
        self.assertEqual(req_mock.call_args[0][0], "/api/meta/tickers/search")

    def test_search_without_client_returns_empty(self) -> None:
        fetcher = _make_fetcher(api_key="")
        self.assertEqual(fetcher._meta_search("茅台"), [])

    def test_search_failure_returns_empty(self) -> None:
        fetcher = _make_fetcher()
        with patch.object(fetcher, "_request_items", side_effect=DataFetchError("boom")):
            self.assertEqual(fetcher._meta_search("茅台"), [])


if __name__ == "__main__":
    unittest.main()
