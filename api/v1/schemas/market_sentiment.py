# -*- coding: utf-8 -*-
"""Market sentiment page API schemas."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

FocusScope = Literal['week', 'month']


class ErrorResponse(BaseModel):
    error: str
    message: str


# ---------- 响应子对象 ----------

class TemperatureItem(BaseModel):
    st: Optional[int] = Field(None, ge=0, le=100)
    trend: Optional[int] = Field(None, ge=0, le=100)


class AmountItem(BaseModel):
    total: Optional[float] = None          # 亿元
    sh: Optional[float] = None
    sz: Optional[float] = None
    vs_prev_pct: Optional[float] = None


class AdvanceDeclineItem(BaseModel):
    up: Optional[int] = None
    down: Optional[int] = None
    flat: Optional[int] = None
    limit_up: Optional[int] = None
    limit_down: Optional[int] = None
    blown_rate: Optional[float] = None


class InflowItem(BaseModel):
    main: Optional[float] = None
    north: Optional[float] = None


class IndicesItem(BaseModel):
    hs300_close: Optional[float] = None
    hs300_chg_pct: Optional[float] = None
    sh50_chg_pct: Optional[float] = None
    chinext_chg_pct: Optional[float] = None
    sh_close: Optional[float] = None          # 上证指数收盘点位
    sh_chg_pct: Optional[float] = None        # 上证指数涨跌幅（%）


class RealtimeIndexItem(BaseModel):
    """实时指数行情（多源字段，均可能缺省；未声明字段忽略）。"""

    code: Optional[str] = None
    name: Optional[str] = None
    current: Optional[float] = None
    change: Optional[float] = None
    change_pct: Optional[float] = None
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    prev_close: Optional[float] = None
    volume: Optional[float] = None
    amount: Optional[float] = None
    amplitude: Optional[float] = None


class RealtimeBlock(BaseModel):
    """盘中实时附加块（indices + 涨跌统计）。"""

    indices: List[RealtimeIndexItem] = Field(default_factory=list)
    market_stats: Optional[Dict[str, Any]] = None


# ---------- 端点响应 ----------

class OverviewResponse(BaseModel):
    """GET /market-sentiment/overview。"""

    trade_date: str
    is_complete: bool
    market_phase: Optional[str] = None       # premarket/intraday/lunch_break/closing_auction/postmarket/non_trading/unknown
    temperature: TemperatureItem
    amount: AmountItem
    advance_decline: AdvanceDeclineItem
    inflow: InflowItem
    indices: IndicesItem
    new_high_60d: Optional[int] = None
    new_low_60d: Optional[int] = None
    overseas: Optional[Dict[str, Any]] = None
    realtime: Optional[RealtimeBlock] = None
    degraded: List[str] = Field(default_factory=list)


class TrendPoint(BaseModel):
    trade_date: str
    sentiment_st: Optional[int] = None
    sentiment_trend: Optional[int] = None
    total_amount: Optional[float] = None
    up_count: Optional[int] = None
    down_count: Optional[int] = None
    limit_up_count: Optional[int] = None
    limit_down_count: Optional[int] = None
    hs300_chg_pct: Optional[float] = None


class TrendResponse(BaseModel):
    """GET /market-sentiment/trend?days=N。"""

    items: List[TrendPoint]
    days: int


class LadderPoint(BaseModel):
    trade_date: str
    height_1: Optional[int] = None
    height_2: Optional[int] = None
    height_3: Optional[int] = None
    height_4: Optional[int] = None
    height_5plus: Optional[int] = None
    max_height: Optional[int] = None
    max_height_code: Optional[str] = None
    max_height_name: Optional[str] = None
    ladder_complete: Optional[int] = None
    first_seal_dist: Optional[Dict[str, Any]] = None
    sector_dist: Optional[List[Dict[str, Any]]] = None
    prev_limit_up_total: Optional[int] = None
    prev_limit_up_again: Optional[int] = None
    prev_limit_up_blown: Optional[int] = None
    prev_limit_up_down: Optional[int] = None


class LadderTrendResponse(BaseModel):
    """GET /market-sentiment/limit-ladder?days=N。"""

    items: List[LadderPoint]
    days: int


class LadderTodayResponse(BaseModel):
    """GET /market-sentiment/limit-ladder/today。"""

    snapshot: Optional[LadderPoint] = None
    pool: List[Dict[str, Any]] = Field(default_factory=list)
    pool_type: str = 'limit_up'              # 'limit_up' | 'limit_down' | 'blown'
    pool_source: Optional[str] = None        # 'snapshot' | 'realtime' | 'snapshot_prev'
    degraded: List[str] = Field(default_factory=list)


class FocusEventItem(BaseModel):
    event_date: str
    title: str
    source: Optional[str] = None
    event_type: Optional[str] = None
    sentiment: Optional[str] = None
    related_sectors: List[str] = Field(default_factory=list)
    related_stocks: List[str] = Field(default_factory=list)
    impact_label: Optional[str] = None
    impact_magnitude: Optional[str] = None
    summary: Optional[str] = None


class FocusStockItem(BaseModel):
    stock_code: str
    stock_name: Optional[str] = None
    concept_tags: List[str] = Field(default_factory=list)
    boards: Optional[int] = None
    reason: Optional[str] = None
    chg_pct: Optional[float] = None
    turnover_rate: Optional[float] = None
    main_inflow: Optional[float] = None
    dragon_tiger: Optional[int] = None
    inst_buy: Optional[int] = None


class FocusSectorItem(BaseModel):
    sector_name: str
    chg_pct: Optional[float] = None
    main_inflow: Optional[float] = None
    leader_code: Optional[str] = None
    leader_name: Optional[str] = None
    limit_up_trend: Optional[List[int]] = None
    lifecycle_stage: Optional[str] = None
    lifecycle_day: Optional[int] = None


class FocusResponse(BaseModel):
    """GET /market-sentiment/focus?scope=week|month。"""

    scope: FocusScope
    events: List[FocusEventItem] = Field(default_factory=list)
    review_events: List[FocusEventItem] = Field(default_factory=list)  # 上一周期热点回顾
    stocks: List[FocusStockItem] = Field(default_factory=list)
    sectors: List[FocusSectorItem] = Field(default_factory=list)
    degraded: List[str] = Field(default_factory=list)


class TomorrowFocusResponse(BaseModel):
    """GET /market-sentiment/tomorrow。"""

    for_date: str
    key_events: List[Dict[str, Any]] = Field(default_factory=list)
    sector_watch: List[Dict[str, Any]] = Field(default_factory=list)
    stock_watch: List[Dict[str, Any]] = Field(default_factory=list)
    ai_preview: Optional[str] = None
    generated_at: Optional[str] = None


class CollectRequest(BaseModel):
    """POST /market-sentiment/collect 请求体。"""

    generate_tomorrow: bool = False

    model_config = ConfigDict(extra='forbid')


class CollectResponse(BaseModel):
    """POST /market-sentiment/collect 响应。"""

    trade_date: str
    snapshot_id: Optional[int] = None
    sentiment_st: Optional[int] = None
    sentiment_trend: Optional[int] = None
    limit_up_pool_size: int = 0
    limit_down_pool_size: int = 0
    blown_pool_size: int = 0
    focus_stocks: int = 0
    focus_sectors: int = 0
    degraded: List[str] = Field(default_factory=list)
    tomorrow_generated: bool = False
