# 知识：ReAct 循环 与 reply_stream 事件流

> 背景来自 AgentScope 2.0（阿里开源 Agent 框架）与本仓库自研 Agent 层（`src/agent/runner.py`）的对比学习。

---

## 一、ReAct 循环（reasoning-acting loop）

### 1.1 是什么

ReAct = **Rea**soning + **Act**ing，让 LLM 交替进行「推理」和「行动」来解决任务的循环模式。出自论文 *ReAct: Synergizing Reasoning and Acting in Language Models* (Yao et al., 2022)。

核心思想：模型不是一次性给出最终答案，而是循环执行：

```
┌─────────────────────────────────────────────┐
│                                             │
│   Thought（推理）                             │
│      "用户问茅台能不能买，我需要先看行情数据"      │
│           │                                 │
│           ▼                                 │
│   Action（行动）── 调用工具                    │
│      tool_call: get_kline("600519")         │
│           │                                 │
│           ▼                                 │
│   Observation（观察）── 拿到工具结果            │
│      {close: 1650, chg_pct: +1.2, ...}      │
│           │                                 │
│           ▼                                 │
│   Thought（再推理）                            │
│      "技术面企稳，再看一下新闻面"                 │
│           │                                 │
│           └────── 循环，直到 ──┐               │
│                             ▼               │
│              Final Answer（最终回答）          │
│                                             │
└─────────────────────────────────────────────┘
```

### 1.2 代码层面的循环本质

ReAct 循环在代码里就是一个 **while 循环**：

```python
# 伪代码，对应 AgentScope / 本仓库 runner.py 的核心逻辑
messages = [system_prompt, user_question]
while True:
    # 1. Reasoning: 调用 LLM
    response = llm.chat(messages, tools=tool_schemas)

    # 2. 判断是否结束
    if not response.tool_calls:          # 模型不再要求调工具
        return response.text              # → 最终答案，退出循环

    # 3. Acting: 执行模型请求的工具
    for call in response.tool_calls:
        result = tool_registry.execute(call.name, call.args)

    # 4. Observation: 把工具结果回填到对话历史
    messages.append(assistant_msg(response.tool_calls))
    messages.append(tool_result_msg(result))
    # → 回到步骤 1，继续推理
```

关键点：

- **决策权在模型**：循环何时结束、调用哪个工具、传什么参数，全部由 LLM 通过 `tool_calls` 字段决定，框架只负责执行和回填
- **无状态可复用**：循环本身不持有任何状态，所有可变状态（对话历史、工具结果）都在调用方的 `messages` 里——本仓库 `runner.py` 的 `run_agent_loop` 就是这么设计的
- **需要护栏**：必须加最大迭代次数（max_iterations）、工具白名单、超时，防止模型死循环或调危险工具

### 1.3 两种工程实现

| 实现方 | 本仓库 | AgentScope 2.0 |
|---|---|---|
| 位置 | `src/agent/runner.py` 的 `run_agent_loop` | `Agent` 类内置 reasoning-acting loop |
| 循环驱动 | 同步 while + ThreadPool 并发执行工具 | async 异步循环 |
| 扩展点 | SkillRouter / 多策略编排（自研） | Middleware 中间件（在循环各阶段插钩子） |
| LLM 网关 | LiteLLM Router（多 provider + 降级链） | 自带 9 个 provider 的模型层 |

两者思路一致：**框架管循环和工具执行，模型管决策**。AgentScope 的 Middleware 只是把"循环中每个环节可插拔"这件事做成了显式机制。

---

## 二、reply_stream 事件流输出

### 2.1 是什么

AgentScope 中 `agent.reply_stream(msg)` 不返回"一个最终结果"，而是返回一个**异步事件生成器**（async generator）。Agent 执行 ReAct 循环的每一步动作都被包装成**事件（Event）**实时推送出来：

```python
async for evt in agent.reply_stream(UserMsg("Tony", "Hi!")):
    match evt.type:
        case EventType.REPLY_START:        ...  # 回合开始
        case EventType.MODEL_CALL_START:   ...  # 开始调用 LLM
        case EventType.TEXT_BLOCK_START:   ...  # 文本块开始
        case EventType.TEXT_BLOCK_DELTA:   ...  # 文本增量（打字机效果的每一片）
        case EventType.TEXT_BLOCK_END:     ...  # 文本块结束
        case EventType.TOOL_CALL_START:    ...  # 开始执行工具
        case EventType.TOOL_CALL_END:      ...  # 工具执行完
        case EventType.REPLY_END:          ...  # 回合结束
```

### 2.2 为什么要有事件流

普通调用 vs 事件流的区别：

```
普通调用（阻塞式）:
  前端请求 ────── 等待 30~120 秒，白屏 ──────> 拿到完整答案

事件流（流式）:
  前端请求 ─> 立即收到事件序列:
              REPLY_START
              MODEL_CALL_START
              TEXT_BLOCK_DELTA "茅台"          ← 前端立刻开始渲染
              TEXT_BLOCK_DELTA "技术面..."
              TOOL_CALL_START (get_kline)     ← 前端显示"正在查行情..."
              TOOL_CALL_END
              TEXT_BLOCK_DELTA "综合来看..."
              REPLY_END
```

价值：

1. **首字延迟极低**：用户在模型输出第一个 token 时就看到内容（打字机效果）
2. **过程可观测**：能实时展示"正在调用什么工具、执行到哪一步"，对股票分析这种长任务尤其重要
3. **human-in-the-loop**：收到 `TOOL_CALL` 事件时可以暂停，让用户确认后继续（AgentScope 的权限系统就建立在这之上）

### 2.3 delta-then-accumulated 模式

AgentScope 流式输出的一个设计细节：**先给增量，最后一个 chunk 给全量**。

```
Delta: [TextBlock(text='1')]        ← is_last=False，只含这一步新增
Delta: [TextBlock(text=', 2,')]     ← is_last=False
Delta: [TextBlock(text=' 3, ')]     ← is_last=False
Final: [TextBlock(text='1, 2, 3')]  ← is_last=True，完整内容
```

- 前端渲染用 `Delta`（追加显示）
- 落库/日志用 `Final`（不用自己拼增量）
- 调用方不用自己维护"累积器"逻辑

### 2.4 与本仓库 SSE 桥接的对应关系

本仓库 Agent 层已经有一套 SSE 进度透传（`POST /api/v1/agent/chat/stream`），语义与事件流一致：

| AgentScope 事件 | 本仓库对应物 |
|---|---|
| `TEXT_BLOCK_DELTA` | SSE token 增量推送 |
| `TOOL_CALL_START / END` | 工具执行进度事件 |
| `REPLY_START / END` | 会话开始 / 结束事件 |
| 事件总线（统一 Event） | 自研 SSE 桥接层（每处自行封装） |

区别在于：AgentScope 把"哪些事件、什么结构、如何订阅"做成了**统一规范**（前端拿同一套 Event 类型和 Web UI 组件就能渲染），而自研桥接层需要每个业务自行定义事件格式。这是 redesign 若引入 AgentScope 最直接的收益点。

---

## 三、一句话总结

- **ReAct 循环**：`LLM 推理 → 调工具 → 结果回填 → 再推理` 的 while 循环，模型决策、框架执行
- **reply_stream**：把这个循环的每一步包装成事件实时推给调用方，让前端能打字机式渲染、显示工具进度、支持人工介入
