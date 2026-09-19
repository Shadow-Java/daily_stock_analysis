# -*- coding: utf-8 -*-
"""Expectation management API schemas."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

IndexDirection = Literal['up', 'flat', 'down']
IndexMagnitude = Literal['strong', 'moderate', 'weak']
ExpectationMarket = Literal['cn', 'hk', 'us']
StockAction = Literal['buy', 'sell', 'add', 'reduce', 'hold', 'watch']
StockDirection = Literal['up', 'flat', 'down']
ResearchTime = Literal['lt_30m', '30_90m', 'gt_90m']
ExecutionStatus = Literal['executed', 'partial', 'not_executed']


class StockExpectationItem(BaseModel):
    code: str = Field(..., min_length=1, max_length=20)
    name: Optional[str] = None
    action: StockAction
    direction: StockDirection
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    confidence: int = Field(3, ge=1, le=5)
    reasoning: Optional[str] = None


# ---------- 预期主记录 ----------

class ExpectationCreateRequest(BaseModel):
    target_date: date
    market: ExpectationMarket = 'cn'

    # 心理快照（可选）
    emotion_index: Optional[int] = Field(None, ge=1, le=10)
    decision_drivers: Optional[List[str]] = None
    research_time: Optional[ResearchTime] = None
    interference_flags: Optional[List[str]] = None

    # 大盘预期（必填）
    index_direction: IndexDirection
    index_magnitude: Optional[IndexMagnitude] = None
    index_reasoning: str = Field(..., min_length=1)

    # 个股预期
    stock_expectations: Optional[List[StockExpectationItem]] = None

    # 假设与计划
    key_assumptions: Optional[List[str]] = None
    key_risks: Optional[str] = None
    operation_plan: Optional[str] = None
    overall_confidence: int = Field(3, ge=1, le=5)
    tags: Optional[List[str]] = None

    model_config = ConfigDict(extra='forbid')


class ExpectationUpdateRequest(BaseModel):
    emotion_index: Optional[int] = Field(None, ge=1, le=10)
    decision_drivers: Optional[List[str]] = None
    research_time: Optional[ResearchTime] = None
    interference_flags: Optional[List[str]] = None
    index_direction: Optional[IndexDirection] = None
    index_magnitude: Optional[IndexMagnitude] = None
    index_reasoning: Optional[str] = None
    stock_expectations: Optional[List[StockExpectationItem]] = None
    key_assumptions: Optional[List[str]] = None
    key_risks: Optional[str] = None
    operation_plan: Optional[str] = None
    overall_confidence: Optional[int] = Field(None, ge=1, le=5)
    tags: Optional[List[str]] = None

    model_config = ConfigDict(extra='forbid')


class ExpectationItem(BaseModel):
    id: int
    target_date: date
    market: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    emotion_index: Optional[int] = None
    decision_drivers: Optional[Any] = None
    research_time: Optional[str] = None
    interference_flags: Optional[Any] = None

    index_direction: str
    index_magnitude: Optional[str] = None
    index_reasoning: str

    stock_expectations: Optional[Any] = None
    key_assumptions: Optional[Any] = None
    key_risks: Optional[str] = None
    operation_plan: Optional[str] = None
    overall_confidence: Optional[int] = None
    tags: Optional[Any] = None

    model_config = ConfigDict(from_attributes=True)


class ExpectationListResponse(BaseModel):
    items: List[ExpectationItem]
    total: int
    page: int
    page_size: int


# ---------- 结果与复盘 ----------

class SelfReviewRequest(BaseModel):
    self_score: Optional[int] = Field(None, ge=1, le=5)
    execution_status: Optional[ExecutionStatus] = None
    execution_notes: Optional[str] = None
    deviation_reason: Optional[str] = None
    assumption_reviews: Optional[List[Dict[str, Any]]] = None
    lessons: Optional[str] = None

    model_config = ConfigDict(extra='forbid')


class OutcomeItem(BaseModel):
    id: int
    expectation_id: int
    outcome_date: Optional[date] = None
    scored_at: Optional[datetime] = None
    auto_score: Optional[float] = None
    index_score_detail: Optional[Any] = None
    stock_scores: Optional[Any] = None
    self_score: Optional[int] = None
    execution_status: Optional[str] = None
    execution_notes: Optional[str] = None
    deviation_reason: Optional[str] = None
    assumption_reviews: Optional[Any] = None
    lessons: Optional[str] = None
    filled_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# ---------- Agent 评价 ----------

class AgentEvalItem(BaseModel):
    id: int
    expectation_id: int
    eval_type: str
    eval_date: Optional[date] = None
    generated_at: Optional[datetime] = None
    reasoning_quality: Optional[int] = None
    information_usage: Optional[int] = None
    risk_awareness: Optional[int] = None
    execution_alignment: Optional[int] = None
    overall_assessment: Optional[str] = None
    strengths: Optional[Any] = None
    weaknesses: Optional[Any] = None
    improvement_suggestions: Optional[Any] = None
    bias_tags: Optional[Any] = None

    model_config = ConfigDict(from_attributes=True)


# ---------- 聚合详情 ----------

class ExpectationDetailResponse(BaseModel):
    expectation: ExpectationItem
    outcome: Optional[OutcomeItem] = None
    agent_eval: Optional[AgentEvalItem] = None


# ---------- 通用 ----------

class ErrorResponse(BaseModel):
    error: str
    message: str


class ScoreResponse(BaseModel):
    outcome: OutcomeItem
