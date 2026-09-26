# -*- coding: utf-8 -*-
"""大盘情绪页 Repository 层。"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import desc, func, select

from src.storage import (
    DatabaseManager,
    MarketDailySnapshotRecord,
    MarketFocusEventRecord,
    MarketFocusSectorRecord,
    MarketFocusStockRecord,
    MarketLimitLadderSnapshotRecord,
    MarketPoolDetailSnapshotRecord,
    MarketTomorrowFocusRecord,
    utc_naive_now,
)

logger = logging.getLogger(__name__)


class MarketSentimentRepository:
    """大盘情绪六张表的读写（快照 upsert + 聚焦刷新 + 明日重点）。"""

    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        self.db = db_manager or DatabaseManager.get_instance()

    # ------------------------------------------------------------------
    # market_daily_snapshot
    # ------------------------------------------------------------------

    def upsert_daily_snapshot(self, fields: Dict[str, Any]) -> MarketDailySnapshotRecord:
        trade_date = fields['trade_date']
        with self.db.get_session() as session:
            row = session.execute(
                select(MarketDailySnapshotRecord).where(
                    MarketDailySnapshotRecord.trade_date == trade_date
                )
            ).scalar_one_or_none()
            serialized = self._serialize(fields)
            if row is None:
                row = MarketDailySnapshotRecord(**serialized)
                session.add(row)
            else:
                for k, v in serialized.items():
                    setattr(row, k, v)
                row.collected_at = utc_naive_now()
            session.commit()
            session.refresh(row)
            return row

    def get_latest_snapshot(
        self, complete_only: bool = False, exclude_date: Optional[date] = None
    ) -> Optional[MarketDailySnapshotRecord]:
        with self.db.get_session() as session:
            query = select(MarketDailySnapshotRecord)
            if complete_only:
                query = query.where(MarketDailySnapshotRecord.is_complete == 1)
            if exclude_date is not None:
                query = query.where(MarketDailySnapshotRecord.trade_date != exclude_date)
            return session.execute(
                query.order_by(desc(MarketDailySnapshotRecord.trade_date)).limit(1)
            ).scalar_one_or_none()

    def get_snapshot(self, trade_date: date) -> Optional[MarketDailySnapshotRecord]:
        with self.db.get_session() as session:
            return session.execute(
                select(MarketDailySnapshotRecord).where(
                    MarketDailySnapshotRecord.trade_date == trade_date
                )
            ).scalar_one_or_none()

    def list_snapshots(
        self, days: int = 30, complete_only: bool = False
    ) -> List[MarketDailySnapshotRecord]:
        with self.db.get_session() as session:
            query = select(MarketDailySnapshotRecord)
            if complete_only:
                query = query.where(MarketDailySnapshotRecord.is_complete == 1)
            rows = session.execute(
                query.order_by(desc(MarketDailySnapshotRecord.trade_date)).limit(days)
            ).scalars().all()
            return list(reversed(list(rows)))

    # ------------------------------------------------------------------
    # market_limit_ladder_snapshot
    # ------------------------------------------------------------------

    def upsert_ladder_snapshot(self, fields: Dict[str, Any]) -> MarketLimitLadderSnapshotRecord:
        trade_date = fields['trade_date']
        with self.db.get_session() as session:
            row = session.execute(
                select(MarketLimitLadderSnapshotRecord).where(
                    MarketLimitLadderSnapshotRecord.trade_date == trade_date
                )
            ).scalar_one_or_none()
            serialized = self._serialize(fields)
            if row is None:
                row = MarketLimitLadderSnapshotRecord(**serialized)
                session.add(row)
            else:
                for k, v in serialized.items():
                    setattr(row, k, v)
                row.collected_at = utc_naive_now()
            session.commit()
            session.refresh(row)
            return row

    def list_ladder(self, days: int = 5) -> List[MarketLimitLadderSnapshotRecord]:
        with self.db.get_session() as session:
            rows = session.execute(
                select(MarketLimitLadderSnapshotRecord)
                .order_by(desc(MarketLimitLadderSnapshotRecord.trade_date))
                .limit(days)
            ).scalars().all()
            return list(reversed(list(rows)))

    # ------------------------------------------------------------------
    # market_pool_detail_snapshot
    # ------------------------------------------------------------------

    def refresh_pool_details(
        self, trade_date: date, pool_type: str, rows: List[Dict[str, Any]]
    ) -> int:
        """删除当日 (trade_date, pool_type) 旧数据后整体写入。"""
        with self.db.get_session() as session:
            old = session.execute(
                select(MarketPoolDetailSnapshotRecord).where(
                    MarketPoolDetailSnapshotRecord.trade_date == trade_date,
                    MarketPoolDetailSnapshotRecord.pool_type == pool_type,
                )
            ).scalars().all()
            for row in old:
                session.delete(row)
            session.flush()  # 先落 DELETE，避免同键 INSERT 撞唯一约束
            for order, fields in enumerate(rows):
                fields = {
                    **fields,
                    'trade_date': trade_date,
                    'pool_type': pool_type,
                    'sort_order': fields.get('sort_order', order),
                }
                session.add(MarketPoolDetailSnapshotRecord(**self._serialize(fields)))
            session.commit()
            return len(rows)

    def list_pool_details(
        self, trade_date: Optional[date] = None, pool_type: str = 'limit_up'
    ) -> List[MarketPoolDetailSnapshotRecord]:
        """指定交易日的池明细；trade_date 为 None 时取该池最新一个交易日。"""
        with self.db.get_session() as session:
            target_date = trade_date
            if target_date is None:
                target_date = session.execute(
                    select(func.max(MarketPoolDetailSnapshotRecord.trade_date)).where(
                        MarketPoolDetailSnapshotRecord.pool_type == pool_type
                    )
                ).scalar()
                if target_date is None:
                    return []
            rows = session.execute(
                select(MarketPoolDetailSnapshotRecord)
                .where(
                    MarketPoolDetailSnapshotRecord.trade_date == target_date,
                    MarketPoolDetailSnapshotRecord.pool_type == pool_type,
                )
                .order_by(MarketPoolDetailSnapshotRecord.sort_order)
            ).scalars().all()
            return list(rows)

    # ------------------------------------------------------------------
    # market_focus_events / stocks / sectors
    # ------------------------------------------------------------------

    def add_focus_event(self, fields: Dict[str, Any]) -> MarketFocusEventRecord:
        with self.db.get_session() as session:
            exists = session.execute(
                select(MarketFocusEventRecord.id).where(
                    MarketFocusEventRecord.event_date == fields.get('event_date'),
                    MarketFocusEventRecord.scope == fields.get('scope'),
                    MarketFocusEventRecord.title == fields.get('title'),
                )
            ).scalar_one_or_none()
            if exists is not None:
                raise ValueError("event already exists")
            row = MarketFocusEventRecord(**self._serialize(fields))
            session.add(row)
            session.commit()
            session.refresh(row)
            return row

    def list_focus_events(
        self, scope: str, days: int = 7, since_date: Optional[date] = None,
        event_type: Optional[str] = None,
    ) -> List[MarketFocusEventRecord]:
        with self.db.get_session() as session:
            query = select(MarketFocusEventRecord).where(
                MarketFocusEventRecord.scope == scope
            )
            if since_date is not None:
                query = query.where(MarketFocusEventRecord.event_date >= since_date)
            if event_type is not None:
                query = query.where(MarketFocusEventRecord.event_type == event_type)
            return list(
                session.execute(
                    query.order_by(desc(MarketFocusEventRecord.event_date))
                    .limit(max(days * 20, 50))
                ).scalars().all()
            )

    def has_focus_events_since(
        self, scope: str, since: datetime, event_type: Optional[str] = None,
    ) -> bool:
        """周期生成守卫：该 scope 在 since 之后是否已写入过事件（可按 event_type 过滤）。"""
        with self.db.get_session() as session:
            query = select(MarketFocusEventRecord.id).where(
                MarketFocusEventRecord.scope == scope,
                MarketFocusEventRecord.created_at >= since,
            )
            if event_type is not None:
                query = query.where(MarketFocusEventRecord.event_type == event_type)
            row = session.execute(query.limit(1)).scalar_one_or_none()
            return row is not None

    def refresh_focus_stocks(
        self, trade_date: date, scope: str, rows: List[Dict[str, Any]]
    ) -> int:
        """删除当日 (trade_date, scope) 旧数据后整体写入。"""
        with self.db.get_session() as session:
            old = session.execute(
                select(MarketFocusStockRecord).where(
                    MarketFocusStockRecord.trade_date == trade_date,
                    MarketFocusStockRecord.scope == scope,
                )
            ).scalars().all()
            for row in old:
                session.delete(row)
            session.flush()  # 先落 DELETE，避免同键 INSERT 撞唯一约束
            for fields in rows:
                fields = {**fields, 'trade_date': trade_date, 'scope': scope}
                session.add(MarketFocusStockRecord(**self._serialize(fields)))
            session.commit()
            return len(rows)

    def refresh_focus_sectors(
        self, trade_date: date, scope: str, rows: List[Dict[str, Any]]
    ) -> int:
        with self.db.get_session() as session:
            old = session.execute(
                select(MarketFocusSectorRecord).where(
                    MarketFocusSectorRecord.trade_date == trade_date,
                    MarketFocusSectorRecord.scope == scope,
                )
            ).scalars().all()
            for row in old:
                session.delete(row)
            session.flush()  # 先落 DELETE，避免同键 INSERT 撞唯一约束
            for fields in rows:
                fields = {**fields, 'trade_date': trade_date, 'scope': scope}
                session.add(MarketFocusSectorRecord(**self._serialize(fields)))
            session.commit()
            return len(rows)

    def latest_focus_date(self, scope: str, kind: str) -> Optional[date]:
        """该 scope 焦点个股/板块最新写入日期（周期生成守卫用）。kind: 'stock'|'sector'。"""
        model = MarketFocusStockRecord if kind == 'stock' else MarketFocusSectorRecord
        with self.db.get_session() as session:
            return session.execute(
                select(func.max(model.trade_date)).where(model.scope == scope)
            ).scalar()

    def list_latest_focus_stocks(
        self, scope: str
    ) -> List[MarketFocusStockRecord]:
        """取该 scope 下最新一个 trade_date 的焦点个股。"""
        with self.db.get_session() as session:
            latest = session.execute(
                select(func.max(MarketFocusStockRecord.trade_date)).where(
                    MarketFocusStockRecord.scope == scope
                )
            ).scalar()
            if latest is None:
                return []
            return list(
                session.execute(
                    select(MarketFocusStockRecord)
                    .where(
                        MarketFocusStockRecord.scope == scope,
                        MarketFocusStockRecord.trade_date == latest,
                    )
                    .order_by(desc(MarketFocusStockRecord.boards))
                ).scalars().all()
            )

    def list_latest_focus_sectors(self, scope: str) -> List[MarketFocusSectorRecord]:
        with self.db.get_session() as session:
            latest = session.execute(
                select(func.max(MarketFocusSectorRecord.trade_date)).where(
                    MarketFocusSectorRecord.scope == scope
                )
            ).scalar()
            if latest is None:
                return []
            return list(
                session.execute(
                    select(MarketFocusSectorRecord)
                    .where(
                        MarketFocusSectorRecord.scope == scope,
                        MarketFocusSectorRecord.trade_date == latest,
                    )
                    .order_by(desc(MarketFocusSectorRecord.chg_pct))
                ).scalars().all()
            )

    # ------------------------------------------------------------------
    # market_tomorrow_focus
    # ------------------------------------------------------------------

    def upsert_tomorrow(self, fields: Dict[str, Any]) -> MarketTomorrowFocusRecord:
        for_date = fields['for_date']
        with self.db.get_session() as session:
            row = session.execute(
                select(MarketTomorrowFocusRecord).where(
                    MarketTomorrowFocusRecord.for_date == for_date
                )
            ).scalar_one_or_none()
            serialized = self._serialize(fields)
            if row is None:
                row = MarketTomorrowFocusRecord(**serialized)
                session.add(row)
            else:
                for k, v in serialized.items():
                    setattr(row, k, v)
                row.generated_at = utc_naive_now()
            session.commit()
            session.refresh(row)
            return row

    def get_latest_tomorrow(self) -> Optional[MarketTomorrowFocusRecord]:
        with self.db.get_session() as session:
            return session.execute(
                select(MarketTomorrowFocusRecord)
                .order_by(desc(MarketTomorrowFocusRecord.for_date))
                .limit(1)
            ).scalar_one_or_none()

    # ------------------------------------------------------------------

    @staticmethod
    def _serialize(fields: Dict[str, Any]) -> Dict[str, Any]:
        """JSON-encode list/dict fields before persisting."""
        json_fields = {
            'overseas_summary', 'first_seal_dist', 'sector_dist',
            'related_sectors', 'related_stocks',
            'concept_tags', 'limit_up_trend',
            'key_events', 'sector_watch', 'stock_watch',
        }
        result = {}
        for k, v in fields.items():
            if k in json_fields and not isinstance(v, str):
                result[k] = json.dumps(v, ensure_ascii=False)
            else:
                result[k] = v
        return result
