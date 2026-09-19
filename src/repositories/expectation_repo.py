# -*- coding: utf-8 -*-
"""预期管理系统 Repository 层。"""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, desc, select

from src.storage import (
    DatabaseManager,
    ExpectationAgentEvalRecord,
    ExpectationOutcomeRecord,
    UserExpectationRecord,
    utc_naive_now,
)


class ExpectationRepository:
    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        self.db = db_manager or DatabaseManager.get_instance()

    def create(self, fields: Dict[str, Any]) -> UserExpectationRecord:
        with self.db.get_session() as session:
            row = UserExpectationRecord(**self._serialize(fields))
            session.add(row)
            session.commit()
            session.refresh(row)
            return row

    def get(self, expectation_id: int) -> Optional[UserExpectationRecord]:
        with self.db.get_session() as session:
            return session.execute(
                select(UserExpectationRecord).where(
                    UserExpectationRecord.id == expectation_id
                )
            ).scalar_one_or_none()

    def get_by_target_date(self, target_date: date) -> Optional[UserExpectationRecord]:
        with self.db.get_session() as session:
            return session.execute(
                select(UserExpectationRecord).where(
                    UserExpectationRecord.target_date == target_date
                )
            ).scalar_one_or_none()

    def list(
        self,
        market: Optional[str] = None,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[UserExpectationRecord], int]:
        from sqlalchemy import func

        conditions = []
        if market:
            conditions.append(UserExpectationRecord.market == market)
        if from_date:
            conditions.append(UserExpectationRecord.target_date >= from_date)
        if to_date:
            conditions.append(UserExpectationRecord.target_date <= to_date)

        where_clause = and_(*conditions) if conditions else True

        with self.db.get_session() as session:
            total = session.execute(
                select(func.count(UserExpectationRecord.id)).where(where_clause)
            ).scalar() or 0
            rows = session.execute(
                select(UserExpectationRecord)
                .where(where_clause)
                .order_by(desc(UserExpectationRecord.target_date))
                .offset((page - 1) * page_size)
                .limit(page_size)
            ).scalars().all()
            return list(rows), int(total)

    def update(self, expectation_id: int, fields: Dict[str, Any]) -> Optional[UserExpectationRecord]:
        with self.db.get_session() as session:
            row = session.execute(
                select(UserExpectationRecord).where(
                    UserExpectationRecord.id == expectation_id
                )
            ).scalar_one_or_none()
            if row is None:
                return None
            for k, v in self._serialize(fields).items():
                setattr(row, k, v)
            row.updated_at = utc_naive_now()
            session.commit()
            session.refresh(row)
            return row

    def delete(self, expectation_id: int) -> bool:
        with self.db.get_session() as session:
            row = session.execute(
                select(UserExpectationRecord).where(
                    UserExpectationRecord.id == expectation_id
                )
            ).scalar_one_or_none()
            if row is None:
                return False
            session.delete(row)
            session.commit()
            return True

    @staticmethod
    def _serialize(fields: Dict[str, Any]) -> Dict[str, Any]:
        """JSON-encode list/dict fields before persisting."""
        result = {}
        json_fields = {
            'decision_drivers', 'interference_flags',
            'stock_expectations', 'key_assumptions', 'tags',
        }
        for k, v in fields.items():
            if k in json_fields and not isinstance(v, str):
                result[k] = json.dumps(v, ensure_ascii=False)
            else:
                result[k] = v
        return result


class ExpectationOutcomeRepository:
    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        self.db = db_manager or DatabaseManager.get_instance()

    def create_or_update(
        self, expectation_id: int, fields: Dict[str, Any]
    ) -> ExpectationOutcomeRecord:
        with self.db.get_session() as session:
            row = session.execute(
                select(ExpectationOutcomeRecord).where(
                    ExpectationOutcomeRecord.expectation_id == expectation_id
                )
            ).scalar_one_or_none()
            serialized = self._serialize(fields)
            if row is None:
                row = ExpectationOutcomeRecord(
                    expectation_id=expectation_id, **serialized
                )
                session.add(row)
            else:
                for k, v in serialized.items():
                    setattr(row, k, v)
                row.updated_at = utc_naive_now()
            session.commit()
            session.refresh(row)
            return row

    def get_by_expectation(
        self, expectation_id: int
    ) -> Optional[ExpectationOutcomeRecord]:
        with self.db.get_session() as session:
            return session.execute(
                select(ExpectationOutcomeRecord).where(
                    ExpectationOutcomeRecord.expectation_id == expectation_id
                )
            ).scalar_one_or_none()

    def update_self_review(
        self, expectation_id: int, fields: Dict[str, Any]
    ) -> Optional[ExpectationOutcomeRecord]:
        with self.db.get_session() as session:
            row = session.execute(
                select(ExpectationOutcomeRecord).where(
                    ExpectationOutcomeRecord.expectation_id == expectation_id
                )
            ).scalar_one_or_none()
            if row is None:
                return None
            allowed = {
                'self_score', 'execution_status', 'execution_notes',
                'deviation_reason', 'assumption_reviews', 'lessons',
            }
            for k, v in self._serialize(fields).items():
                if k in allowed:
                    setattr(row, k, v)
            row.filled_at = utc_naive_now()
            row.updated_at = utc_naive_now()
            session.commit()
            session.refresh(row)
            return row

    @staticmethod
    def _serialize(fields: Dict[str, Any]) -> Dict[str, Any]:
        json_fields = {'index_score_detail', 'stock_scores', 'assumption_reviews'}
        result = {}
        for k, v in fields.items():
            if k in json_fields and not isinstance(v, str):
                result[k] = json.dumps(v, ensure_ascii=False)
            else:
                result[k] = v
        return result


class ExpectationAgentEvalRepository:
    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        self.db = db_manager or DatabaseManager.get_instance()

    def create(self, fields: Dict[str, Any]) -> ExpectationAgentEvalRecord:
        with self.db.get_session() as session:
            row = ExpectationAgentEvalRecord(**self._serialize(fields))
            session.add(row)
            session.commit()
            session.refresh(row)
            return row

    def get_latest_by_expectation(
        self, expectation_id: int
    ) -> Optional[ExpectationAgentEvalRecord]:
        with self.db.get_session() as session:
            return session.execute(
                select(ExpectationAgentEvalRecord)
                .where(ExpectationAgentEvalRecord.expectation_id == expectation_id)
                .order_by(desc(ExpectationAgentEvalRecord.generated_at))
                .limit(1)
            ).scalar_one_or_none()

    def list_by_expectation(
        self, expectation_id: int
    ) -> List[ExpectationAgentEvalRecord]:
        with self.db.get_session() as session:
            return list(
                session.execute(
                    select(ExpectationAgentEvalRecord)
                    .where(ExpectationAgentEvalRecord.expectation_id == expectation_id)
                    .order_by(desc(ExpectationAgentEvalRecord.generated_at))
                ).scalars().all()
            )

    @staticmethod
    def _serialize(fields: Dict[str, Any]) -> Dict[str, Any]:
        json_fields = {'strengths', 'weaknesses', 'improvement_suggestions', 'bias_tags'}
        result = {}
        for k, v in fields.items():
            if k in json_fields and not isinstance(v, str):
                result[k] = json.dumps(v, ensure_ascii=False)
            else:
                result[k] = v
        return result
