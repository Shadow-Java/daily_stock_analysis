# -*- coding: utf-8 -*-
"""预期管理 Agent 评价服务：使用 LLM 对用户预期质量进行点评。"""

from __future__ import annotations

import json
import logging
from datetime import date
from typing import Any, Dict, List, Optional

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
    utc_naive_now,
)

logger = logging.getLogger(__name__)

EVAL_SYSTEM_PROMPT = """你是一位经验丰富的交易心理教练和量化研究员。
你的任务是帮助用户打磨自己的交易思维，识别认知偏差，提升预期管理质量。
评价时保持客观、具体、建设性，避免空话。每条意见都要有依据。"""

BIAS_TYPES = [
    '锚定偏差', '确认偏差', '近因效应', '损失厌恶',
    '过度自信', 'FOMO', '处置效应', '可得性启发',
]


def _safe_json(value: Optional[str]) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return value


class ExpectationAgentService:
    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        self.db = db_manager or DatabaseManager.get_instance()
        self.repo = ExpectationRepository(self.db)
        self.outcome_repo = ExpectationOutcomeRepository(self.db)
        self.eval_repo = ExpectationAgentEvalRepository(self.db)

    def evaluate(self, expectation_id: int) -> ExpectationAgentEvalRecord:
        """生成 Agent 评价，写入数据库并返回。"""
        expectation = self.repo.get(expectation_id)
        if expectation is None:
            raise ValueError(f"预期记录不存在: id={expectation_id}")

        outcome = self.outcome_repo.get_by_expectation(expectation_id)
        history = self._get_recent_evals(expectation_id)

        prompt = self._build_prompt(expectation, outcome, history)
        raw_text = self._call_llm(prompt)
        parsed = self._parse_response(raw_text)

        fields: Dict[str, Any] = {
            'expectation_id': expectation_id,
            'eval_type': 'single',
            'eval_date': (
                expectation.target_date
                if isinstance(expectation.target_date, date)
                else date.today()
            ),
            'generated_at': utc_naive_now(),
            **parsed,
        }
        return self.eval_repo.create(fields)

    # ------------------------------------------------------------------ #
    # Prompt 构建
    # ------------------------------------------------------------------ #

    def _build_prompt(
        self,
        exp: UserExpectationRecord,
        outcome: Optional[ExpectationOutcomeRecord],
        history: List[ExpectationAgentEvalRecord],
    ) -> str:
        sections = [
            f"## 预期日期\n{exp.target_date}",
            f"## 市场\n{exp.market or 'cn'}",
        ]

        # 心理快照
        snapshot_parts = []
        if exp.emotion_index is not None:
            snapshot_parts.append(f"- 情绪指数: {exp.emotion_index}/10（1=极度恐惧，10=极度贪婪）")
        if exp.decision_drivers:
            drivers = _safe_json(exp.decision_drivers)
            snapshot_parts.append(f"- 判断驱动: {drivers}")
        if exp.research_time:
            snapshot_parts.append(f"- 研究时间: {exp.research_time}")
        if exp.interference_flags:
            flags = _safe_json(exp.interference_flags)
            snapshot_parts.append(f"- 干扰因素: {flags}")
        if snapshot_parts:
            sections.append("## 心理快照\n" + "\n".join(snapshot_parts))

        # 大盘预期
        index_parts = [
            f"- 方向: {exp.index_direction}",
        ]
        if exp.index_magnitude:
            index_parts.append(f"- 幅度: {exp.index_magnitude}")
        if exp.index_reasoning:
            index_parts.append(f"- 推理: {exp.index_reasoning}")
        sections.append("## 大盘预期\n" + "\n".join(index_parts))

        # 个股预期
        stocks = _safe_json(exp.stock_expectations)
        if stocks:
            stock_lines = []
            for s in stocks:
                line = (
                    f"  - {s.get('code','?')} "
                    f"[{s.get('action','?')}] 方向:{s.get('direction','?')} "
                    f"信心:{s.get('confidence','?')}/5"
                )
                if s.get('reasoning'):
                    line += f" | {s['reasoning']}"
                stock_lines.append(line)
            sections.append("## 个股预期\n" + "\n".join(stock_lines))

        # 核心假设
        assumptions = _safe_json(exp.key_assumptions)
        if assumptions:
            lines = [f"  {i+1}. {a}" for i, a in enumerate(assumptions)]
            sections.append("## 核心假设\n" + "\n".join(lines))

        # 风险
        if exp.key_risks:
            sections.append(f"## 关键风险\n{exp.key_risks}")

        # 操作计划
        if exp.operation_plan:
            sections.append(f"## 操作计划\n{exp.operation_plan}")

        # 实际结果（如有）
        if outcome:
            result_parts = []
            if outcome.auto_score is not None:
                result_parts.append(f"- 自动评分: {outcome.auto_score}/100")
            if outcome.index_score_detail:
                detail = _safe_json(outcome.index_score_detail)
                if isinstance(detail, dict):
                    result_parts.append(
                        f"- 大盘实际涨跌: {detail.get('actual_pct_chg', 'N/A')}%"
                        f"，方向命中: {detail.get('direction_hit', False)}"
                    )
            if outcome.self_score:
                result_parts.append(f"- 用户自评: {outcome.self_score}/5")
            if outcome.execution_status:
                result_parts.append(f"- 执行情况: {outcome.execution_status}")
            if outcome.lessons:
                result_parts.append(f"- 用户复盘: {outcome.lessons}")
            if result_parts:
                sections.append("## 实际结果\n" + "\n".join(result_parts))

        # 历史点评摘要
        if history:
            hist_parts = [
                f"  - {e.eval_date}: 推理质量{e.reasoning_quality}, 风险意识{e.risk_awareness}"
                for e in history[:3]
            ]
            sections.append("## 近期历史评价摘要\n" + "\n".join(hist_parts))

        content = "\n\n".join(sections)
        return (
            content
            + f"\n\n---\n请按以下 JSON 格式返回评价（不要有额外文字）：\n"
            + """{
  "reasoning_quality": <1-5整数>,
  "information_usage": <1-5整数>,
  "risk_awareness": <1-5整数>,
  "execution_alignment": <1-5整数或null>,
  "overall_assessment": "<整体评价，100-200字>",
  "strengths": ["<优点1>", "<优点2>"],
  "weaknesses": ["<不足1>", "<不足2>"],
  "improvement_suggestions": ["<建议1>", "<建议2>"],
  "bias_tags": ["<检测到的认知偏差，从列表中选："""
            + "、".join(BIAS_TYPES)
            + """>"]
}"""
        )

    # ------------------------------------------------------------------ #
    # LLM 调用
    # ------------------------------------------------------------------ #

    def _call_llm(self, prompt: str) -> str:
        from src.config import get_config
        from src.llm.backend_factory import create_generation_backend

        config = get_config()
        backend_id = getattr(config, 'generation_backend', None) or 'litellm'
        litellm_callable = None

        if backend_id == 'litellm':
            try:
                import litellm
                litellm_callable = litellm.completion
            except ImportError:
                logger.warning("litellm 未安装，尝试 local_cli 后端")
                backend_id = 'local_cli'

        backend = create_generation_backend(
            backend_id,
            config=config,
            litellm_completion_callable=litellm_callable,
        )
        result = backend.generate(
            prompt,
            generation_config={'max_tokens': 1024, 'temperature': 0.3},
            system_prompt=EVAL_SYSTEM_PROMPT,
        )
        return result.content if hasattr(result, 'content') else str(result)

    # ------------------------------------------------------------------ #
    # 解析 LLM 输出
    # ------------------------------------------------------------------ #

    def _parse_response(self, raw: str) -> Dict[str, Any]:
        import re

        # 尝试提取 JSON block
        json_match = re.search(r'\{[\s\S]*\}', raw)
        if json_match:
            try:
                data = json.loads(json_match.group())
                return {
                    'reasoning_quality': self._clamp(data.get('reasoning_quality'), 1, 5),
                    'information_usage': self._clamp(data.get('information_usage'), 1, 5),
                    'risk_awareness': self._clamp(data.get('risk_awareness'), 1, 5),
                    'execution_alignment': self._clamp(data.get('execution_alignment'), 1, 5),
                    'overall_assessment': str(data.get('overall_assessment', '')),
                    'strengths': data.get('strengths', []),
                    'weaknesses': data.get('weaknesses', []),
                    'improvement_suggestions': data.get('improvement_suggestions', []),
                    'bias_tags': data.get('bias_tags', []),
                }
            except json.JSONDecodeError:
                pass

        # 解析失败时保存原始文本
        logger.warning("Agent 评价 JSON 解析失败，保存原始文本")
        return {
            'overall_assessment': raw[:2000],
            'strengths': [],
            'weaknesses': [],
            'improvement_suggestions': [],
            'bias_tags': [],
        }

    @staticmethod
    def _clamp(value: Any, lo: int, hi: int) -> Optional[int]:
        if value is None:
            return None
        try:
            v = int(value)
            return max(lo, min(hi, v))
        except (TypeError, ValueError):
            return None

    def _get_recent_evals(
        self, expectation_id: int, limit: int = 3
    ) -> List[ExpectationAgentEvalRecord]:
        try:
            return self.eval_repo.list_by_expectation(expectation_id)[:limit]
        except Exception:
            return []
