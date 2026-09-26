# -*- coding: utf-8 -*-
"""大盘情绪页 API endpoints。"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Security
from fastapi.security import APIKeyCookie

from api.v1.schemas.market_sentiment import (
    CollectRequest,
    CollectResponse,
    ErrorResponse,
    FocusResponse,
    LadderTodayResponse,
    LadderTrendResponse,
    LadderPoint,
    OverviewResponse,
    TomorrowFocusResponse,
    TrendPoint,
    TrendResponse,
)
from src.auth import COOKIE_NAME
from src.services.market_sentiment_service import MarketSentimentService

logger = logging.getLogger(__name__)

admin_session_cookie = APIKeyCookie(
    name=COOKIE_NAME,
    scheme_name="AdminSessionCookie",
    auto_error=False,
)
router = APIRouter(dependencies=[Security(admin_session_cookie)])


def _bad_request(msg: str) -> HTTPException:
    return HTTPException(status_code=400, detail={"error": "bad_request", "message": msg})


def _internal_error(msg: str, exc: Exception) -> HTTPException:
    logger.error("%s: %s", msg, exc, exc_info=True)
    return HTTPException(status_code=500, detail={"error": "internal_error", "message": msg})


@router.get(
    "/overview",
    response_model=OverviewResponse,
    responses={500: {"model": ErrorResponse}},
    summary="情绪总览（按 A 股交易阶段自动决定来源；realtime=true 显式强制实时）",
    operation_id="getSentimentOverview",
)
def get_overview(
    realtime: bool = Query(
        False,
        description="显式强制实时数据（任意阶段直接拉源）；"
                    "缺省时按阶段自动：盘中附实时块（60s 缓存），"
                    "盘后自动补采当日快照，盘前/节假日纯读库",
    ),
) -> OverviewResponse:
    service = MarketSentimentService()
    try:
        data = service.get_overview(realtime=realtime)
        return OverviewResponse(**data)
    except Exception as exc:
        raise _internal_error("查询情绪总览失败", exc)


@router.get(
    "/trend",
    response_model=TrendResponse,
    responses={500: {"model": ErrorResponse}},
    summary="近 N 日情绪趋势（双温度/成交额/涨跌家数）",
    operation_id="getSentimentTrend",
)
def get_trend(
    days: int = Query(30, ge=1, le=250),
) -> TrendResponse:
    service = MarketSentimentService()
    try:
        items = service.get_trend(days=days)
        return TrendResponse(items=[TrendPoint(**i) for i in items], days=days)
    except Exception as exc:
        raise _internal_error("查询情绪趋势失败", exc)


@router.get(
    "/limit-ladder/today",
    response_model=LadderTodayResponse,
    responses={500: {"model": ErrorResponse}},
    summary="今日池详情（当日快照优先，盘中实时兜底；pool_type 区分涨停/跌停/炸板池）",
    operation_id="getSentimentLadderToday",
)
def get_ladder_today(
    pool_type: str = Query(
        'limit_up', pattern='^(limit_up|limit_down|blown)$',
        description="池类型：涨停池/跌停池/炸板池",
    ),
) -> LadderTodayResponse:
    service = MarketSentimentService()
    try:
        data = service.get_ladder_today(pool_type=pool_type)
        snapshot = LadderPoint(**data['snapshot']) if data.get('snapshot') else None
        return LadderTodayResponse(
            snapshot=snapshot,
            pool=data.get('pool') or [],
            pool_type=data.get('pool_type') or pool_type,
            pool_source=data.get('pool_source'),
            degraded=data.get('degraded') or [],
        )
    except Exception as exc:
        raise _internal_error("查询今日梯队失败", exc)


@router.get(
    "/limit-ladder",
    response_model=LadderTrendResponse,
    responses={500: {"model": ErrorResponse}},
    summary="近 N 日涨停梯队演化",
    operation_id="getSentimentLadder",
)
def get_ladder_trend(
    days: int = Query(5, ge=1, le=60),
) -> LadderTrendResponse:
    service = MarketSentimentService()
    try:
        items = service.get_ladder_trend(days=days)
        return LadderTrendResponse(
            items=[LadderPoint(**i) for i in items], days=days
        )
    except Exception as exc:
        raise _internal_error("查询梯队演化失败", exc)


@router.get(
    "/focus",
    response_model=FocusResponse,
    responses={500: {"model": ErrorResponse}},
    summary="市场聚焦（事件/个股/板块）",
    operation_id="getSentimentFocus",
)
def get_focus(
    scope: str = Query('week', pattern='^(week|month)$'),
) -> FocusResponse:
    service = MarketSentimentService()
    try:
        data = service.get_focus(scope)
        return FocusResponse(**data)
    except Exception as exc:
        raise _internal_error("查询市场聚焦失败", exc)


@router.get(
    "/tomorrow",
    response_model=Optional[TomorrowFocusResponse],
    responses={500: {"model": ErrorResponse}},
    summary="明日重点聚焦",
    operation_id="getSentimentTomorrow",
)
def get_tomorrow() -> Optional[TomorrowFocusResponse]:
    service = MarketSentimentService()
    try:
        data = service.get_tomorrow()
        return TomorrowFocusResponse(**data) if data else None
    except Exception as exc:
        raise _internal_error("查询明日重点失败", exc)


@router.post(
    "/collect",
    response_model=CollectResponse,
    responses={500: {"model": ErrorResponse}},
    summary="触发收盘采集（写快照，可同时生成明日重点）",
    operation_id="collectSentiment",
)
def collect_sentiment(request: CollectRequest) -> CollectResponse:
    service = MarketSentimentService()
    try:
        collected = service.collect_daily_snapshot()
        tomorrow_generated = False
        if request.generate_tomorrow:
            tomorrow_generated = service.generate_tomorrow_focus() is not None
        return CollectResponse(
            **collected,
            tomorrow_generated=tomorrow_generated,
        )
    except Exception as exc:
        raise _internal_error("情绪采集失败", exc)
