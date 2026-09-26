# -*- coding: utf-8 -*-
"""大盘情绪页阶段感知读数测试（盘中实时 TTL / 盘后自动补采 / 纯读库）。"""
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import date, datetime
from unittest.mock import patch

from sqlalchemy import inspect

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from src.config import Config
from src.core.trading_calendar import MarketPhase
from src.services import market_sentiment_service as service_module
from src.services.market_sentiment_service import (
    MarketSentimentService,
    _parse_indices,
)
from src.storage import DatabaseManager


def _cn_indices(region='cn'):
    """模拟 manager.get_main_indices：仅 cn 返回指数行。"""
    if region != 'cn':
        return []
    return [
        {'code': '000001', 'name': '上证指数', 'current': 3888.0,
         'change': -48.0, 'change_pct': -1.22, 'volume': 1.0, 'amount': 783.6e9},
        {'code': '000300', 'name': '沪深300', 'current': 4439.0,
         'change': -78.0, 'change_pct': -1.73, 'volume': 1.0, 'amount': 375.4e9},
    ]


class _FakeManager:
    """带调用计数的伪 fetcher manager（未实现的方法返回无害空值）。"""

    def __init__(self):
        self.indices_calls = 0
        self.stats_calls = 0

    def get_main_indices(self, region='cn'):
        self.indices_calls += 1
        return _cn_indices(region)

    def get_market_stats(self, *, purpose='unspecified'):
        self.stats_calls += 1
        return {
            'up_count': 1000, 'down_count': 4000, 'flat_count': 100,
            'limit_up_count': 50, 'limit_down_count': 10,
            'total_amount': 16000.0,
        }

    def __getattr__(self, name):
        def _missing(*args, **kwargs):
            if name == 'get_sector_rankings':
                return [], []
            return []
        return _missing


class TestParseIndicesShFields(unittest.TestCase):

    def test_sh_close_and_chg_extracted(self):
        rows = _cn_indices()
        rows.append({'code': '399106', 'name': '深证综指', 'current': 2476.0,
                     'change': -49.0, 'change_pct': -1.97, 'volume': 1.0,
                     'amount': 869.7e9})
        parsed = _parse_indices(rows)
        self.assertEqual(parsed['sh_close'], 3888.0)
        self.assertEqual(parsed['sh_chg_pct'], -1.22)
        self.assertAlmostEqual(parsed['sh_amount'], 7836.0, places=2)
        self.assertAlmostEqual(parsed['sz_amount'], 8697.0, places=2)
        self.assertEqual(parsed['hs300_chg_pct'], -1.73)


class TestPhaseAwareOverview(unittest.TestCase):

    def setUp(self):
        DatabaseManager.reset_instance()
        Config.reset_instance()
        self.db = DatabaseManager(db_url='sqlite:///:memory:')
        self.manager = _FakeManager()
        self.service = MarketSentimentService(
            db_manager=self.db, fetcher_manager=self.manager
        )
        cache = service_module._realtime_cache
        cache['data'] = None
        cache['expires_at'] = 0.0
        service_module._auto_collect_state.clear()

    def tearDown(self):
        DatabaseManager.reset_instance()
        Config.reset_instance()

    # ---- 盘中：附实时块，60s TTL 内只打一次源 ----

    def test_intraday_attaches_realtime_with_ttl(self):
        with patch.object(service_module, 'infer_market_phase',
                          return_value=MarketPhase.INTRADAY):
            first = self.service.get_overview()
            second = self.service.get_overview()
        self.assertEqual(first['market_phase'], 'intraday')
        self.assertEqual(len(first['realtime']['indices']), 2)
        self.assertEqual(first['realtime']['market_stats']['up_count'], 1000)
        self.assertEqual(self.manager.indices_calls, 1)   # TTL 命中
        self.assertEqual(self.manager.stats_calls, 1)
        self.assertEqual(second['realtime']['indices'],
                         first['realtime']['indices'])

    def test_explicit_realtime_bypasses_ttl_expiry(self):
        with patch.object(service_module, 'infer_market_phase',
                          return_value=MarketPhase.PREMARKET):
            forced = self.service.get_overview(realtime=True)
        self.assertIsNotNone(forced['realtime'])
        self.assertEqual(self.manager.indices_calls, 1)

    # ---- 盘前/节假日：纯读库，零外部调用 ----

    def test_premarket_no_external_calls(self):
        with patch.object(service_module, 'infer_market_phase',
                          return_value=MarketPhase.PREMARKET):
            data = self.service.get_overview()
        self.assertIsNone(data['realtime'])
        self.assertEqual(data['market_phase'], 'premarket')
        self.assertEqual(self.manager.indices_calls, 0)
        self.assertEqual(self.manager.stats_calls, 0)

    def test_non_trading_no_external_calls(self):
        with patch.object(service_module, 'infer_market_phase',
                          return_value=MarketPhase.NON_TRADING):
            data = self.service.get_overview()
        self.assertIsNone(data['realtime'])
        self.assertEqual(self.manager.indices_calls, 0)

    # ---- 盘后：自动补采（后台线程，测试内联执行），按日幂等 ----

    def _patch_postmarket_clock(self, trade_day):
        with_patch = patch
        return (
            with_patch.object(service_module, 'infer_market_phase',
                              return_value=MarketPhase.POSTMARKET),
            with_patch.object(service_module, 'get_market_now',
                              return_value=datetime(2026, 9, 24, 15, 30)),
            with_patch.object(MarketSentimentService,
                              '_resolve_snapshot_trade_date',
                              return_value=trade_day),
            with_patch.object(service_module.threading, 'Thread',
                              _InlineThread),
        )

    def test_postmarket_auto_collects_once_then_reads_db(self):
        trade_day = date(2026, 9, 24)
        patches = self._patch_postmarket_clock(trade_day)
        with patches[0], patches[1], patches[2], patches[3]:
            first = self.service.get_overview()
            # 内联线程已写库：当日快照完整
            snapshot = self.service.repo.get_snapshot(trade_day)
            self.assertIsNotNone(snapshot)
            self.assertEqual(snapshot.is_complete, 1)
            self.assertIn('snapshot_collecting', first['degraded'])
            stats_after_first = self.manager.stats_calls
            second = self.service.get_overview()
        self.assertNotIn('snapshot_collecting', second['degraded'])
        self.assertEqual(self.manager.stats_calls, stats_after_first)  # 二次读库不再采集

    def test_postmarket_grace_window_skips_collect(self):
        trade_day = date(2026, 9, 24)
        patches = self._patch_postmarket_clock(trade_day)
        grace = patch.object(service_module, 'get_market_now',
                             return_value=datetime(2026, 9, 24, 15, 1))
        with patches[0], grace, patches[2], patches[3]:
            data = self.service.get_overview()
        self.assertNotIn('snapshot_collecting', data['degraded'])
        self.assertEqual(self.manager.stats_calls, 0)

    def test_postmarket_complete_snapshot_skips_collect(self):
        trade_day = date(2026, 9, 24)
        self.service.repo.upsert_daily_snapshot(
            {'trade_date': trade_day, 'is_complete': 1, 'total_amount': 100.0}
        )
        patches = self._patch_postmarket_clock(trade_day)
        with patches[0], patches[1], patches[2], patches[3]:
            data = self.service.get_overview()
        self.assertEqual(self.manager.stats_calls, 0)
        self.assertNotIn('snapshot_collecting', data['degraded'])

    def test_explicit_realtime_forces_fetch_in_postmarket(self):
        trade_day = date(2026, 9, 24)
        patches = self._patch_postmarket_clock(trade_day)
        with patches[0], patches[1], patches[2], patches[3]:
            data = self.service.get_overview(realtime=True)
        self.assertIsNotNone(data['realtime'])
        self.assertEqual(self.manager.indices_calls, 1)


class _InlineThread:
    """测试用同步 Thread 替身：start() 即执行 target。"""

    def __init__(self, target=None, name=None, daemon=False):
        self._target = target

    def start(self):
        if self._target is not None:
            self._target()


class TestSnapshotColumnMigration(unittest.TestCase):

    def test_legacy_db_gets_sh_columns(self):
        DatabaseManager.reset_instance()
        Config.reset_instance()
        temp_dir = tempfile.TemporaryDirectory()
        db_path = os.path.join(temp_dir.name, 'legacy_sentiment.sqlite')
        legacy_cols = (
            'id INTEGER PRIMARY KEY, trade_date DATE NOT NULL UNIQUE, '
            'is_complete INTEGER NOT NULL DEFAULT 0'
        )
        with sqlite3.connect(db_path) as conn:
            conn.execute(
                f'CREATE TABLE market_daily_snapshot ({legacy_cols})'
            )
        try:
            DatabaseManager(db_url=f'sqlite:///{db_path}')
            with sqlite3.connect(db_path) as conn:
                cols = {
                    row[1] for row in conn.execute(
                        'PRAGMA table_info(market_daily_snapshot)'
                    ).fetchall()
                }
            self.assertIn('sh_close', cols)
            self.assertIn('sh_chg_pct', cols)
            # 幂等：二次实例化不报错
            DatabaseManager.reset_instance()
            DatabaseManager(db_url=f'sqlite:///{db_path}')
            engine = DatabaseManager.get_instance()._engine
            names = {
                c['name']
                for c in inspect(engine).get_columns('market_daily_snapshot')
            }
            self.assertIn('sh_close', names)
        finally:
            DatabaseManager.reset_instance()
            Config.reset_instance()
            temp_dir.cleanup()


if __name__ == '__main__':
    unittest.main()
