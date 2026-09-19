# -*- coding: utf-8 -*-
"""收盘评分引擎：根据实际行情对用户预期自动打分。"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from src.repositories.expectation_repo import ExpectationOutcomeRepository
from src.storage import (
    DatabaseManager,
    ExpectationOutcomeRecord,
    UserExpectationRecord,
    utc_naive_now,
    StockDaily,
    select,
    and_,
)

logger = logging.getLogger(__name__)

# 大盘指数代码（沪深300作为A股代理）
INDEX_CODE_MAP: Dict[str, str] = {
    'cn': '000300',
    'hk': 'HKHSI',
    'us': 'SPY',
}

# 方向判定阈值（%）
DIRECTION_THRESHOLD = 0.3   # 涨跌超过此阈值才算有方向
STRONG_THRESHOLD = 1.5
MODERATE_THRESHOLD = 0.5


def _pct_to_direction(pct_chg: float) -> str:
    if pct_chg > DIRECTION_THRESHOLD:
        return 'up'
    if pct_chg < -DIRECTION_THRESHOLD:
        return 'down'
    return 'flat'


def _pct_to_magnitude(pct_chg: float) -> str:
    abs_pct = abs(pct_chg)
    if abs_pct >= STRONG_THRESHOLD:
        return 'strong'
    if abs_pct >= MODERATE_THRESHOLD:
        return 'moderate'
    return 'weak'


class ExpectationScorer:
    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        self.db = db_manager or DatabaseManager.get_instance()
        self.outcome_repo = ExpectationOutcomeRepository(self.db)

    def score(
        self,
        expectation: UserExpectationRecord,
        target_date: Optional[date] = None,
    ) -> ExpectationOutcomeRecord:
        """对一条预期执行自动评分，返回更新后的 ExpectationOutcomeRecord。"""
        score_date = target_date or (
            expectation.target_date if isinstance(expectation.target_date, date)
            else date.today()
        )

        index_detail, index_score = self._score_index(
            expectation.market or 'cn',
            expectation.index_direction,
            expectation.index_magnitude,
            score_date,
        )

        stock_scores_data, stock_score = self._score_stocks(
            expectation.stock_expectations,
            score_date,
        )

        # 大盘占40分，个股占60分（无个股时全部来自大盘）
        if stock_scores_data:
            auto_score = index_score * 0.4 + stock_score * 0.6
        else:
            auto_score = index_score

        outcome_fields: Dict[str, Any] = {
            'outcome_date': score_date,
            'scored_at': utc_naive_now(),
            'auto_score': round(auto_score, 1),
            'index_score_detail': index_detail,
            'stock_scores': stock_scores_data,
        }

        return self.outcome_repo.create_or_update(expectation.id, outcome_fields)

    def _score_index(
        self,
        market: str,
        predicted_direction: str,
        predicted_magnitude: Optional[str],
        score_date: date,
    ) -> tuple:
        index_code = INDEX_CODE_MAP.get(market, '000300')
        pct_chg = self._get_pct_chg(index_code, score_date)

        if pct_chg is None:
            detail = {
                'predicted_direction': predicted_direction,
                'predicted_magnitude': predicted_magnitude,
                'actual_pct_chg': None,
                'actual_direction': None,
                'direction_hit': False,
                'magnitude_hit': False,
                'score': 50.0,
                'note': '行情数据未找到，给予基准分',
            }
            return detail, 50.0

        actual_direction = _pct_to_direction(pct_chg)
        actual_magnitude = _pct_to_magnitude(pct_chg)
        direction_hit = actual_direction == predicted_direction
        magnitude_hit = (
            predicted_magnitude is not None
            and actual_magnitude == predicted_magnitude
            and direction_hit
        )

        score = 0.0
        if direction_hit:
            score += 70.0
        if magnitude_hit:
            score += 30.0

        detail = {
            'predicted_direction': predicted_direction,
            'predicted_magnitude': predicted_magnitude,
            'actual_pct_chg': pct_chg,
            'actual_direction': actual_direction,
            'actual_magnitude': actual_magnitude,
            'direction_hit': direction_hit,
            'magnitude_hit': magnitude_hit,
            'score': score,
        }
        return detail, score

    def _score_stocks(
        self,
        stock_expectations_json: Optional[str],
        score_date: date,
    ) -> tuple:
        if not stock_expectations_json:
            return [], 50.0

        try:
            stocks: List[Dict[str, Any]] = json.loads(stock_expectations_json)
        except (json.JSONDecodeError, TypeError):
            return [], 50.0

        if not stocks:
            return [], 50.0

        results = []
        scores = []
        for item in stocks:
            code = item.get('code', '')
            predicted_dir = item.get('direction', '')
            pct_chg = self._get_pct_chg(code, score_date)

            if pct_chg is None:
                results.append({
                    'code': code,
                    'predicted_direction': predicted_dir,
                    'actual_pct_chg': None,
                    'direction_hit': False,
                    'score': 50.0,
                    'note': '行情数据未找到',
                })
                scores.append(50.0)
                continue

            actual_dir = _pct_to_direction(pct_chg)
            direction_hit = predicted_dir == actual_dir if predicted_dir else False
            score = 100.0 if direction_hit else 0.0

            # 有目标价且当日触达，额外奖励
            target_price = item.get('target_price')
            if target_price and pct_chg > 0:
                score = min(score + 10.0, 100.0)

            results.append({
                'code': code,
                'predicted_direction': predicted_dir,
                'actual_pct_chg': pct_chg,
                'actual_direction': actual_dir,
                'direction_hit': direction_hit,
                'score': score,
            })
            scores.append(score)

        avg_score = sum(scores) / len(scores) if scores else 50.0
        return results, avg_score

    def _get_pct_chg(self, code: str, target_date: date) -> Optional[float]:
        try:
            with self.db.get_session() as session:
                row = session.execute(
                    select(StockDaily).where(
                        and_(
                            StockDaily.code == code,
                            StockDaily.date == target_date,
                        )
                    ).limit(1)
                ).scalar_one_or_none()
                return row.pct_chg if row else None
        except Exception as exc:
            logger.warning("获取行情数据失败 %s %s: %s", code, target_date, exc)
            return None
