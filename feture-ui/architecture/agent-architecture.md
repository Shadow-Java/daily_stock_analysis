# Agent 架构总结（src/agent/）

> 日期：2026-09-21
> 配套：[architecture.md](./architecture.md)（整体分层）

## 〇、一句话概括

主项目的 Agent **没有用 LangChain/LangGraph 等框架**，而是自研了一套「**LiteLLM 模型网关 + 统一 ReAct 执行循环 + 多 Agent 编排 + YAML 技能系统**」。同一套底层跑两条业务路径：

1. **单股分析**（`AgentOrchestrator` 多 Agent 流水线）
2. **对话问股**（`AgentExecutor` / `ChatExecutor` 的工具调用循环）

---

## 一、整体结构图

```
                     api/v1/endpoints/agent.py (FastAPI + SSE)
                                     │
                     src/agent/factory.py  (统一构建入口)
        ┌────────────────────────────┴────────────────────────────┐
        │                                                         │
   AgentOrchestrator (多Agent分析)                          AgentExecutor / ChatExecutor
    or chestrator.py                                          executor.py / chat_executor.py
        │                                                         │
        └──────────────────────┬──────────────────────────────────┘
                               │
                     runner.py  run_agent_loop  (统一 ReAct 循环)
                               │
                     llm_adapter.py  LLMToolAdapter  (LiteLLM Router)
                     agent_backend.py (Backend 契约) · codex_agent_backend.py
                               │
                ┌──────────────┼──────────────────┐
                │              │                  │
          ToolRegistry     skills/            agents/
          (工具注册)      (YAML技能+多策略)   (technical/intel/risk/decision/portfolio)
                │
          protocols.py  (AgentContext / AgentOpinion / StageResult ...)
          memory.py · conversation.py · chat_context.py  (会话记忆)
          events.py (EventMonitor) · stream_events.py (SSE进度)
```

---

## 二、核心抽象（protocols.py）

统一的数据结构，纯 dataclass（无 ORM 依赖，可序列化跨进程传递）：

| 类型 | 作用 |
|------|------|
| `Signal` / 归一化函数 | 交易信号枚举 + 别名归一（strong_buy→buy 等），多策略契约的单一事实源 |
| `AgentContext` | 单次运行的共享状态袋：query、data（实时行情/历史/筹码/新闻）、opinions、risk_flags、meta |
| `AgentOpinion` | 单个 Agent 的意见（signal/confidence/reasoning/key_levels），confidence 自动 clamp 到 [0,1] |
| `StrategyOpinion` | 归一化后的策略意见（含 conditions_met/missed、invalid_signal） |
| `StrategyConflict` | 策略间的确定性冲突 |
| `StageResult` / `StageStatus` | 单阶段结果（PENDING/RUNNING/COMPLETED/FAILED/SKIPPED）+ 失败原因（TIMEOUT/BUDGET_SKIP） |
| `AgentRunStats` | 整次运行的聚合统计（tokens/tool_calls/duration/models_used） |

---

## 三、执行循环（runner.py）

`run_agent_loop` 是**唯一权威的 ReAct 实现**（从旧 `AgentExecutor._run_loop` 抽出），单 Agent 与多 Agent 共用：

```
system prompt (persona + 工具声明 + 技能)
        │
        ▼
   LLM (经 LLMToolAdapter)
        │
   ├─ tool_call → 执行工具 → 结果回填 → 循环
   ├─ text      → 解析为最终答案 / dashboard JSON
   └─ 达到 max_steps (AGENT_MAX_STEPS) → 终止
```

设计要点：**无状态**——所有可变状态在调用方；通过回调注入进度/消息/结果处理；工具执行带并发 ThreadPool、缓存键、股票范围守卫（stock_scope）。

---

## 四、模型网关（llm_adapter.py + agent_backend.py）

- `LLMToolAdapter`：基于 `litellm.Router`，把各 provider 的 function-calling 差异**归一化成统一 tool-use 接口**；支持多模型路由/降级。
- `agent_backend.py`：`AgentBackend` 抽象契约 + LiteLLM 零回归 wrapper；后端错误码集合（command_not_found / login_required / capability_unsupported...）。
- `codex_agent_backend.py`：可选 **OpenAI Codex CLI** 后端（`codex_app_server_transport.py` 负责进程/传输，`codex_tool_process.py` 工具子进程）。

---

## 五、工具系统（tools/）

`registry.py` 提供 `ToolRegistry` + `@tool` 装饰器 + 多 provider schema 生成。工具按类别分文件：

| 文件 | 工具类别 |
|------|---------|
| `analysis_tools.py` | 技术分析（趋势/均线/形态/筹码） |
| `data_tools.py` | 行情/历史/基本面 |
| `market_tools.py` | 市场指数/板块排名 |
| `search_tools.py` | 新闻/综合情报搜索 |
| `backtest_tools.py` | 技能/策略/个股回测 |

工具名 → 中文名映射在 `api/v1/endpoints/agent.py`（如 `get_realtime_quote`→「获取实时行情」）。

---

## 六、技能系统（skills/）

**YAML 技能**（`skills/base.py` + `SkillManager`）：技能是自然语言描述的 YAML（内置在根目录 `strategies/*.yaml`），用户可零代码新增自定义技能；`SkillManager` 加载后把技能指令注入 prompt。

**多策略流水线**（specialist 模式）由 skills/ 下的模块协作：

| 模块 | 职责 |
|------|------|
| `router.py` SkillRouter | 规则式技能选择：用户显式指定 > 市场 regime 检测 > 默认兜底 |
| `scheduler.py` AgentSkillScheduler | 并发调度多个策略 SkillAgent（ThreadPool） |
| `skill_agent.py` SkillAgent | 单技能运行时适配器（specialist mode） |
| `aggregator.py` SkillAggregator | 对多技能意见做**加权聚合** |
| `synthesis.py` StrategySynthesizer | 冲突检测 + 综合成共识信号 |
| `deliberation.py` DeliberationMediator | 多 Agent 分歧时的再协商 |
| `engine.py` StrategyEngine | 多策略流水线门面 |

---

## 七、多 Agent 编排（orchestrator.py）

`AgentOrchestrator` 管理单股分析中专用 Agent 的生命周期，与 `AgentExecutor` 同接口（`run` / `chat`），可经 factory 直接替换。

**运行模式**（按 LLM 调用次数从少到多）：

```
quick      : Technical → Decision          (~2 次调用)
standard   : Technical → Intel → Decision  (默认)
full       : Technical → Intel → Risk → Decision
specialist : Technical → Intel → Risk → 策略评估 → Decision
```

流程：seed `AgentContext` → 顺序跑 Agent（共享 context）→ 收集 `StageResult` → 产出统一 `OrchestratorResult`（含最终 dashboard）。

`agents/` 目录是各专用 Agent：`technical_agent` / `intel_agent` / `risk_agent` / `decision_agent` / `portfolio_agent`（组合视角）/ `base_agent`（基类）。

---

## 八、会话记忆（memory / conversation / chat_context）

- `memory.py`：Agent 记忆
- `conversation.py` + `chat_context.py`：多轮对话历史构建（`build_visible_chat_history`、`build_agent_chat_context_bundle`）
- 会话持久化走 `src/services/agent_chat_session_service.py` + storage；API 暴露 `/chat/sessions` CRUD

---

## 九、流式与事件

- `stream_events.py`：`stream_event()` 构造进度事件字典（`type/step/tool/success/duration/stage/meta`），供 SSE 透传，保持字段向后兼容。
- API `POST /chat/stream`：`StreamingResponse`（`text/event-stream`）+ `progress_callback` → `event_generator`，支持 `POST /chat/stream/{request_id}/cancel` 取消。
- `events.py` `EventMonitor`：**独立的**价格阈值/涨跌幅/放量监控，跑在定时任务里，与流水线无关。

---

## 十、入口与构建（factory.py + api）

- `factory.build_agent_executor`：单股分析 executor
- `factory.build_agent_chat_executor`：对话 executor
- `factory._build_orchestrator`：多 Agent 编排
- 性能：`ToolRegistry` 模块级缓存；`SkillManager` 首次构建原型、每次 `deepcopy`（线程安全，因 `activate()` 会改内部状态）。

`api/v1/endpoints/agent.py` 路由：`/models`、`/skills`、`/strategies`、`/status`、`/chat`、`/chat/stream`、`/chat/sessions` CRUD、`/research`。

---

## 附：扩展指南

| 想做的事 | 改哪里 |
|---------|--------|
| 加一个工具 | `tools/*_tools.py` 用 `@tool` 注册（自动生成 schema） |
| 加一个交易策略技能 | 新增 YAML（`strategies/`），无需写 Python |
| 加一个分析 Agent | `agents/` 继承 `base_agent.BaseAgent`，接入 orchestrator 流水线 |
| 换/加一个模型 provider | 走 LiteLLM 配置（`src/llm/`），无需改执行循环 |
| 换执行后端 | 实现 `AgentBackend` 契约（参考 codex_agent_backend.py） |
| 新前端接 Agent | 直接用 `POST /api/v1/agent/chat` 或 `/chat/stream` |
