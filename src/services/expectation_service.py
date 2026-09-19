# -*- coding: utf-8 -*-
"""预期管理 CRUD 服务。"""

from __future__ import annotations

import json
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from src.repositories.expectation_repo import (
    ExpectationAgentEvalRepository,
    ExpectationOutcomeRepository,
    ExpectationRepository,
)
from src.storage import (
    DatabaseManager,
    ExpectationAgentEvalRecord,
    ExpectationOutcomeRecord,
    UserExpectationRecord,
)

INDEX_DIRECTIONS = frozenset({'up', 'flat', 'down'})
INDEX_MAGNITUDES = frozenset({'strong', 'moderate', 'weak'})
EXECUTION_STATUSES = frozenset({'executed', 'partial', 'not_executed'})
DECISION_DRIVERS = frozenset({'data', 'news', 'gut', 'follow', 'impulse'})
RESEARCH_TIMES = frozenset({'lt_30m', '30_90m', 'gt_90m'})
STOCK_ACTIONS = frozenset({'buy', 'sell', 'add', 'reduce', 'hold', 'watch'})


class ExpectationService:
    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        self.db = db_manager or DatabaseManager.get_instance()
        self.repo = ExpectationRepository(self.db)
        self.outcome_repo = ExpectationOutcomeRepository(self.db)
        self.eval_repo = ExpectationAgentEvalRepository(self.db)

    # ------------------------------------------------------------------ #
    # 预期主记录 CRUD
    # ------------------------------------------------------------------ #

    def create_expectation(self, payload: Dict[str, Any]) -> UserExpectationRecord:
        self._validate_expectation_payload(payload)
        return self.repo.create(payload)

    def get_expectation(self, expectation_id: int) -> Optional[UserExpectationRecord]:
        return self.repo.get(expectation_id)

    def get_today_expectation(self, market: str = 'cn') -> Optional[UserExpectationRecord]:
        """返回以今日为 target_date 的预期（如果存在）。"""
        return self.repo.get_by_target_date(date.today())

    def list_expectations(
        self,
        market: Optional[str] = None,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[UserExpectationRecord], int]:
        return self.repo.list(
            market=market,
            from_date=from_date,
            to_date=to_date,
            page=page,
            page_size=page_size,
        )

    def update_expectation(
        self, expectation_id: int, payload: Dict[str, Any]
    ) -> Optional[UserExpectationRecord]:
        if 'index_direction' in payload:
            self._validate_expectation_payload(payload)
        return self.repo.update(expectation_id, payload)

    def delete_expectation(self, expectation_id: int) -> bool:
        return self.repo.delete(expectation_id)

    # ------------------------------------------------------------------ #
    # 自我复盘
    # ------------------------------------------------------------------ #

    def fill_self_review(
        self, expectation_id: int, payload: Dict[str, Any]
    ) -> Optional[ExpectationOutcomeRecord]:
        self._validate_self_review_payload(payload)
        return self.outcome_repo.update_self_review(expectation_id, payload)

    def get_outcome(self, expectation_id: int) -> Optional[ExpectationOutcomeRecord]:
        return self.outcome_repo.get_by_expectation(expectation_id)

    # ------------------------------------------------------------------ #
    # Agent 评价
    # ------------------------------------------------------------------ #

    def get_agent_eval(
        self, expectation_id: int
    ) -> Optional[ExpectationAgentEvalRecord]:
        return self.eval_repo.get_latest_by_expectation(expectation_id)

    # ------------------------------------------------------------------ #
    # 校验
    # ------------------------------------------------------------------ #

    @staticmethod
    def _validate_expectation_payload(payload: Dict[str, Any]) -> None:
        direction = payload.get('index_direction')
        if direction and direction not in INDEX_DIRECTIONS:
            raise ValueError(
                f"index_direction 无效: {direction!r}，允许值: {sorted(INDEX_DIRECTIONS)}"
            )
        magnitude = payload.get('index_magnitude')
        if magnitude and magnitude not in INDEX_MAGNITUDES:
            raise ValueError(
                f"index_magnitude 无效: {magnitude!r}，允许值: {sorted(INDEX_MAGNITUDES)}"
            )
        confidence = payload.get('overall_confidence')
        if confidence is not None and not (1 <= int(confidence) <= 5):
            raise ValueError("overall_confidence 须在 1-5 之间")
        emotion = payload.get('emotion_index')
        if emotion is not None and not (1 <= int(emotion) <= 10):
            raise ValueError("emotion_index 须在 1-10 之间")
        research_time = payload.get('research_time')
        if research_time and research_time not in RESEARCH_TIMES:
            raise ValueError(
                f"research_time 无效: {research_time!r}，允许值: {sorted(RESEARCH_TIMES)}"
            )
        stocks = payload.get('stock_expectations')
        if stocks:
            if isinstance(stocks, str):
                stocks = json.loads(stocks)
            for item in stocks:
                action = item.get('action')
                if action and action not in STOCK_ACTIONS:
                    raise ValueError(
                        f"stock action 无效: {action!r}，允许值: {sorted(STOCK_ACTIONS)}"
                    )

    @staticmethod
    def _validate_self_review_payload(payload: Dict[str, Any]) -> None:
        self_score = payload.get('self_score')
        if self_score is not None and not (1 <= int(self_score) <= 5):
            raise ValueError("self_score 须在 1-5 之间")
        execution_status = payload.get('execution_status')
        if execution_status and execution_status not in EXECUTION_STATUSES:
            raise ValueError(
                f"execution_status 无效: {execution_status!r}，允许值: {sorted(EXECUTION_STATUSES)}"
            )
