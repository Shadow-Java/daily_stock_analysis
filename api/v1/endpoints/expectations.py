# -*- coding: utf-8 -*-
"""预期管理系统 API endpoints。"""

from __future__ import annotations

import json
import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Security
from fastapi.security import APIKeyCookie

from api.v1.schemas.expectations import (
    AgentEvalItem,
    ErrorResponse,
    ExpectationCreateRequest,
    ExpectationDetailResponse,
    ExpectationItem,
    ExpectationListResponse,
    ExpectationUpdateRequest,
    OutcomeItem,
    ScoreResponse,
    SelfReviewRequest,
)
from src.auth import COOKIE_NAME
from src.services.expectation_agent_service import ExpectationAgentService
from src.services.expectation_scorer import ExpectationScorer
from src.services.expectation_service import ExpectationService

logger = logging.getLogger(__name__)

admin_session_cookie = APIKeyCookie(
    name=COOKIE_NAME,
    scheme_name="AdminSessionCookie",
    auto_error=False,
)
router = APIRouter(dependencies=[Security(admin_session_cookie)])


def _not_found(msg: str) -> HTTPException:
    return HTTPException(status_code=404, detail={"error": "not_found", "message": msg})


def _bad_request(msg: str) -> HTTPException:
    return HTTPException(status_code=400, detail={"error": "bad_request", "message": msg})


def _internal_error(msg: str, exc: Exception) -> HTTPException:
    logger.error("%s: %s", msg, exc, exc_info=True)
    return HTTPException(status_code=500, detail={"error": "internal_error", "message": msg})


def _row_to_item(row) -> ExpectationItem:
    """将 ORM 行转为 Pydantic schema（JSON 字段反序列化）。"""
    data = {c.key: getattr(row, c.key) for c in row.__table__.columns}
    for field in ('decision_drivers', 'interference_flags', 'stock_expectations',
                  'key_assumptions', 'tags'):
        v = data.get(field)
        if isinstance(v, str):
            try:
                data[field] = json.loads(v)
            except (json.JSONDecodeError, TypeError):
                pass
    return ExpectationItem(**data)


def _outcome_to_item(row) -> OutcomeItem:
    data = {c.key: getattr(row, c.key) for c in row.__table__.columns}
    for field in ('index_score_detail', 'stock_scores', 'assumption_reviews'):
        v = data.get(field)
        if isinstance(v, str):
            try:
                data[field] = json.loads(v)
            except (json.JSONDecodeError, TypeError):
                pass
    return OutcomeItem(**data)


def _eval_to_item(row) -> AgentEvalItem:
    data = {c.key: getattr(row, c.key) for c in row.__table__.columns}
    for field in ('strengths', 'weaknesses', 'improvement_suggestions', 'bias_tags'):
        v = data.get(field)
        if isinstance(v, str):
            try:
                data[field] = json.loads(v)
            except (json.JSONDecodeError, TypeError):
                pass
    return AgentEvalItem(**data)


# ------------------------------------------------------------------ #
# 创建 / 列表
# ------------------------------------------------------------------ #

@router.post(
    "",
    response_model=ExpectationItem,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="创建每日预期",
    operation_id="createExpectation",
)
def create_expectation(request: ExpectationCreateRequest) -> ExpectationItem:
    service = ExpectationService()
    try:
        payload = request.model_dump(exclude_unset=True)
        # 序列化 list 子对象
        for k in ('stock_expectations', 'key_assumptions', 'decision_drivers',
                  'interference_flags', 'tags'):
            if k in payload and isinstance(payload[k], list):
                items = payload[k]
                payload[k] = [
                    i.model_dump() if hasattr(i, 'model_dump') else i
                    for i in items
                ]
        row = service.create_expectation(payload)
        return _row_to_item(row)
    except ValueError as exc:
        raise _bad_request(str(exc))
    except Exception as exc:
        raise _internal_error("创建预期失败", exc)


@router.get(
    "",
    response_model=ExpectationListResponse,
    summary="预期列表",
    operation_id="listExpectations",
)
def list_expectations(
    market: Optional[str] = Query(None, description="市场筛选: cn/hk/us"),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> ExpectationListResponse:
    service = ExpectationService()
    try:
        rows, total = service.list_expectations(
            market=market,
            from_date=from_date,
            to_date=to_date,
            page=page,
            page_size=page_size,
        )
        return ExpectationListResponse(
            items=[_row_to_item(r) for r in rows],
            total=total,
            page=page,
            page_size=page_size,
        )
    except Exception as exc:
        raise _internal_error("查询预期列表失败", exc)


@router.get(
    "/today",
    response_model=Optional[ExpectationItem],
    summary="今日预期（快捷接口）",
    operation_id="getTodayExpectation",
)
def get_today_expectation() -> Optional[ExpectationItem]:
    service = ExpectationService()
    row = service.get_today_expectation()
    return _row_to_item(row) if row else None


# ------------------------------------------------------------------ #
# 单条 CRUD
# ------------------------------------------------------------------ #

@router.get(
    "/{expectation_id}",
    response_model=ExpectationDetailResponse,
    responses={404: {"model": ErrorResponse}},
    summary="获取预期详情（含结果 & Agent 评价）",
    operation_id="getExpectation",
)
def get_expectation(expectation_id: int) -> ExpectationDetailResponse:
    service = ExpectationService()
    row = service.get_expectation(expectation_id)
    if row is None:
        raise _not_found(f"预期不存在: id={expectation_id}")

    outcome_row = service.get_outcome(expectation_id)
    eval_row = service.get_agent_eval(expectation_id)

    return ExpectationDetailResponse(
        expectation=_row_to_item(row),
        outcome=_outcome_to_item(outcome_row) if outcome_row else None,
        agent_eval=_eval_to_item(eval_row) if eval_row else None,
    )


@router.patch(
    "/{expectation_id}",
    response_model=ExpectationItem,
    responses={400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    summary="更新预期",
    operation_id="updateExpectation",
)
def update_expectation(
    expectation_id: int, request: ExpectationUpdateRequest
) -> ExpectationItem:
    service = ExpectationService()
    try:
        payload = request.model_dump(exclude_unset=True)
        for k in ('stock_expectations', 'key_assumptions', 'decision_drivers',
                  'interference_flags', 'tags'):
            if k in payload and isinstance(payload[k], list):
                payload[k] = [
                    i.model_dump() if hasattr(i, 'model_dump') else i
                    for i in payload[k]
                ]
        row = service.update_expectation(expectation_id, payload)
        if row is None:
            raise _not_found(f"预期不存在: id={expectation_id}")
        return _row_to_item(row)
    except HTTPException:
        raise
    except ValueError as exc:
        raise _bad_request(str(exc))
    except Exception as exc:
        raise _internal_error("更新预期失败", exc)


@router.delete(
    "/{expectation_id}",
    status_code=204,
    responses={404: {"model": ErrorResponse}},
    summary="删除预期",
    operation_id="deleteExpectation",
)
def delete_expectation(expectation_id: int) -> None:
    service = ExpectationService()
    if not service.delete_expectation(expectation_id):
        raise _not_found(f"预期不存在: id={expectation_id}")


# ------------------------------------------------------------------ #
# 评分
# ------------------------------------------------------------------ #

@router.post(
    "/{expectation_id}/score",
    response_model=ScoreResponse,
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="触发收盘自动评分",
    operation_id="scoreExpectation",
)
def score_expectation(expectation_id: int) -> ScoreResponse:
    service = ExpectationService()
    row = service.get_expectation(expectation_id)
    if row is None:
        raise _not_found(f"预期不存在: id={expectation_id}")
    try:
        scorer = ExpectationScorer()
        outcome = scorer.score(row)
        return ScoreResponse(outcome=_outcome_to_item(outcome))
    except Exception as exc:
        raise _internal_error("评分失败", exc)


# ------------------------------------------------------------------ #
# 自我复盘
# ------------------------------------------------------------------ #

@router.patch(
    "/{expectation_id}/outcome",
    response_model=OutcomeItem,
    responses={400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    summary="填写自我复盘",
    operation_id="fillSelfReview",
)
def fill_self_review(
    expectation_id: int, request: SelfReviewRequest
) -> OutcomeItem:
    service = ExpectationService()
    if service.get_expectation(expectation_id) is None:
        raise _not_found(f"预期不存在: id={expectation_id}")
    try:
        payload = request.model_dump(exclude_unset=True)
        row = service.fill_self_review(expectation_id, payload)
        if row is None:
            raise _not_found("该预期尚未有评分记录，请先触发评分")
        return _outcome_to_item(row)
    except HTTPException:
        raise
    except ValueError as exc:
        raise _bad_request(str(exc))
    except Exception as exc:
        raise _internal_error("填写复盘失败", exc)


# ------------------------------------------------------------------ #
# Agent 评价
# ------------------------------------------------------------------ #

@router.post(
    "/{expectation_id}/eval",
    response_model=AgentEvalItem,
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="触发 Agent 评价",
    operation_id="triggerAgentEval",
)
def trigger_agent_eval(expectation_id: int) -> AgentEvalItem:
    service = ExpectationService()
    if service.get_expectation(expectation_id) is None:
        raise _not_found(f"预期不存在: id={expectation_id}")
    try:
        agent_service = ExpectationAgentService()
        row = agent_service.evaluate(expectation_id)
        return _eval_to_item(row)
    except ValueError as exc:
        raise _bad_request(str(exc))
    except Exception as exc:
        raise _internal_error("Agent 评价失败", exc)


@router.get(
    "/{expectation_id}/eval",
    response_model=Optional[AgentEvalItem],
    responses={404: {"model": ErrorResponse}},
    summary="获取最新 Agent 评价",
    operation_id="getAgentEval",
)
def get_agent_eval(expectation_id: int) -> Optional[AgentEvalItem]:
    service = ExpectationService()
    if service.get_expectation(expectation_id) is None:
        raise _not_found(f"预期不存在: id={expectation_id}")
    row = service.get_agent_eval(expectation_id)
    return _eval_to_item(row) if row else None
