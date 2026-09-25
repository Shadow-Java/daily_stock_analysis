# Agent 工具决策机制 与 UI→Agent 调用链路

> 源码坐标：工具层 `src/agent/tools/`，执行循环 `src/agent/runner.py`，API `api/v1/endpoints/agent.py`，前端 `apps/dsa-web/src/api/agent.ts`。

---

## 一、Agent 如何决策调用哪个 tool

### 1.1 核心答案：决策者是 LLM，不是代码

没有任何 if/else 规则决定"什么情况调什么工具"。框架把所有工具的 **JSON Schema** 交给 LLM，LLM 在推理时自主决定调用哪个、传什么参数、何时停止——即 ReAct 循环里的 "Reasoning" 环节。代码只负责三件事：**把工具说明给模型、执行模型的调用指令、把结果喂回去**。

### 1.2 工具如何变成"AI 认识的语言"

```
① 开发者写普通 Python 函数 + @tool 装饰器
   @tool(
       name="get_realtime_quote",
       description="获取股票实时行情快照",
   )
   def get_realtime_quote(stock_code: str, market: str = "cn") -> dict: ...

② registry.py 自动生成 schema（无需手写 JSON）
   _infer_parameters()          # registry.py:395 从 type hints 推断参数列表
   _params_json_schema()        # registry.py:97  参数 → JSON Schema
   to_openai_schema()           # registry.py:138 输出 OpenAI function-calling 格式
      {"type":"function","function":{"name":...,"description":...,"parameters":{...}}}

③ ToolRegistry 汇总注册（registry.py:169）
   tools/ 下各模块（data_tools / market_tools / search_tools / analysis_tools / backtest_tools）
   在 import 时注册进全局 Registry
```

### 1.3 循环中的决策与分发（runner.py `run_agent_loop`）

```
run_agent_loop(messages, tools, ...)                 # runner.py:326
  │
  ▼ while 循环（受 max_iterations / 剩余超时约束）
  │
  ├─ llm_adapter.chat(messages, tools=所有工具的 schema)
  │      → LiteLLM Router → provider（OpenAI/Anthropic/Gemini/DeepSeek 归一化）
  │
  ├─ response.tool_calls 为空？
  │      → 是：模型给出最终文本答案，返回，循环结束
  │
  ├─ response.tool_calls 非空（runner.py:487）：
  │      1. assistant 消息（含 tool_calls）追加进 messages
  │      2. _execute_tool_calls()（runner.py:710）分发执行：
  │           registry.execute(tc.name, **tc.args)      # registry.py:302
  │           - ThreadPool 并发（多工具同时调）
  │           - tc_order 保持模型给出的调用顺序（first-wins 链，Issue #1890 契约）
  │      3. 每个结果包装成 tool role 消息追加进 messages
  │      4. 回到循环顶部 → 模型看到结果继续推理
```

### 1.4 决策质量的四个护栏

| 护栏 | 位置 | 作用 |
|---|---|---|
| **ToolPolicy** | registry.py:89~ | 每个工具声明 `read_only / side_effects / permissions / scope_dimensions`，标注"查行情=只读网络" vs "写缓存=动 DB"，供权限层检查 |
| **股票范围守卫** | registry.py:284（识别 stock_code 参数） | 工具带 `stock_code` 参数时受会话股票范围约束，防止 AI 查范围外的票 |
| **DataFetcherManager 单例** | data_tools.py:58 | 工具执行取数走唯一出口（12 源 fallback），跨工具调用共享熔断冷却，避免每次重初始化 |
| **终止条件** | runner.py | 无 tool_calls → 自然结束；max_iterations / 总超时 → 强制截断，防死循环 |

> 也就是说：**"调什么工具"模型说了算；"能不能调、调了会怎样"代码说了算。**

---

## 二、UI → Agent 完整调用链路

### 2.1 全链路图（流式对话 `/chat/stream`）

```
┌─ 前端 apps/dsa-web ─────────────────────────────────────────────┐
│ 用户输入"用龙头战法分析600519"                                    │
│   ↓                                                             │
│ agentApi.streamChat()                  src/api/agent.ts:120     │
│   fetch POST /api/v1/agent/chat/stream                          │
│   + ReadableStream.getReader() 逐块读 SSE                       │
│   （开发期 Vite proxy: /api → 127.0.0.1:8000）                   │
└──────────────────────────────────────────────────────────────────┘
   ↓ HTTP POST (SSE 响应)
┌─ 后端 FastAPI ───────────────────────────────────────────────────┐
│ api/v1/endpoints/agent.py:476  @router.post("/chat/stream")     │
│   ↓ （挂载于 api/v1/router.py:44，prefix=/agent）                │
│                                                                                 │
│ ❶ 鉴权 + 解析请求（session_id / message / context / skills）      │
│ ❷ factory.py 构建 ChatExecutor：                                  │
│      - resolve_stock_scope()   从消息解析股票范围                  │
│      - SkillManager.get_skill_instructions()  YAML 技能注入 prompt │
│      - 会话历史（conversation_* 表）拼进 messages                  │
│ ❸ executor 调 runner.run_agent_loop()   ←—— ReAct 循环             │
│      ├→ llm_adapter (LiteLLM Router) → provider   [模型调用]      │
│      └→ ToolRegistry.execute → data_tools → data_provider         │
│                                          → akshare/tushare/...    │
│ ❹ 每一步产生事件 → SSE 逐条 yield：                                │
│      token 增量 / 工具开始结束 / 进度 / 最终消息                    │
└──────────────────────────────────────────────────────────────────┘
   ↓ SSE chunks
前端 reader 解析 → 打字机渲染 + 工具进度提示 → 完成
```

### 2.2 前端消费方式

`apps/dsa-web/src/api/agent.ts` 的 `agentApi`：

| 方法 | 端点 | 说明 |
|---|---|---|
| `streamChat()` | `POST /api/v1/agent/chat/stream` | fetch + ReadableStream 手工解析 SSE（不是 EventSource，因为要 POST body） |
| `cancel()` | `POST /api/v1/agent/chat/stream/{request_id}/cancel` | 中断正在跑的回合（agent.py:663） |
| `chat()` | `POST /api/v1/agent/chat` | 非流式一次性返回（agent.py:197） |
| 会话管理 | `GET /chat/sessions`、`GET /chat/sessions/{id}` | 历史会话列表/消息（落 `conversation_*` 表） |
| 元信息 | `GET /models`、`/status`、`/skills`、`/strategies` | 渲染模型选择器、技能开关（agent.py:118~188） |

### 2.3 一次提问的时序（带工具）

```
t0  用户发送消息
t1  后端构建 system prompt（技能 instructions + 股票范围 + 会话历史）
t2  LLM 第 1 轮推理 → 返回 tool_calls: [get_sector_rankings, get_realtime_quote]
t3  SSE: tool_start 事件 ×2 → 前端显示"正在查板块排行…"
t4  ThreadPool 并发执行两个工具 → DataFetcherManager → 数据源
t5  结果回填 messages
t6  LLM 第 2 轮推理 → 纯文本回答（无 tool_calls）
t7  SSE: token delta 流式输出 → 打字机渲染
t8  SSE: done → 前端收尾，消息落库（conversation_messages）
```

### 2.4 redesign 对接要点

- **不需要新写链路**：现有 `POST /api/v1/agent/chat/stream` 即可完整复用（SSE 格式 + cancel 语义都是现成契约）
- 若参考 AgentScope 的事件总线（见 `redesign/knowledge/react-loop-and-reply-stream.md`），可以把后端 SSE 事件升级为统一 Event 类型（REPLY_START / TEXT_BLOCK_DELTA / TOOL_CALL_* / REPLY_END），前端用同一套渲染组件
- 工具决策逻辑对前端完全透明：前端只消费"事件流"，不关心模型选了哪个工具、走了哪个数据源
