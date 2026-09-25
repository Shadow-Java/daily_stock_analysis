# generic-comment-api — 通用 AI 短文案生成接口

> 版本: v0.1 | 日期: 2026-09-25 | 状态: 草稿待评审
> 关联: [design.md](design.md)（首个接入场景）、`../storage-design.md`、`../../../platform/agent/`（LLM 网关）

---

## 一、为什么需要通用接口

项目里存在大量同类需求：**输入一份结构化事实，输出一小段受长度约束的评价/解读/应对提示**，生成时机都在采集或任务尾部（离线、批量），页面只读库。已识别的场景见 §七 清单：情绪页动态过程、外盘背离解读、维度背离解读、情绪卡 💡 tip、明日重点 preview、个股入选理由、预期管理评价、交易成长复盘建议……

若各处自行拼 prompt、自行调 `LLMToolAdapter`、自行写降级模板，会带来三类问题：

1. 重复实现：调用、解析、超时、重试、降级逻辑每处抄一遍；
2. 口径漂移：有的给买卖建议、有的没有；有的标 `source`、有的不标；降级行为不一致；
3. 无法统一治理：长度上限、成本控制（每日一次、幂等覆盖）、数字幻觉约束没有单一收口。

**目标：一个场景注册表 + 一个生成入口 `generate(scene_id, context)`，统一"事实清单 → 文案"的契约与保护栏。**

## 二、定位与边界

| 边界 | 说明 |
|---|---|
| 不是 HTTP 实时接口 | 生成只发生在采集尾部 / 任务尾部（离线批量）；页面与业务 API **永远读库**，不实时调 LLM（与 auto-review 同一原则） |
| 不是新 LLM 客户端 | 底层复用 `src/agent/llm_adapter.py LLMToolAdapter.call_text()`，渠道 / 模型 / 超时全部走现有配置，不新增配置项 |
| 不接管规则判定 | "要不要说、说什么数字"仍由各业务自己的规则引擎决定（如 design.md §三）；本接口只负责"怎么说 + 校验 + 降级 + 落库" |

## 三、场景注册表（Scene）

每个场景注册一个 `SceneSpec`，生成入口只认注册表，不写 if-else：

| 字段 | 说明 | 示例（`sentiment.review`） |
|---|---|---|
| `scene_id` | 全局唯一标识 | `'sentiment.review'` |
| `prompt_template` | 系统提示词（含输出 schema 与约束） | design.md §4.2 |
| `few_shot` | 少量示例，文案口径的"标准答案" | mockup 两段文案 |
| `facts_builder` | 回调：从上下文产出事实清单 dict | 读快照表 + review 表 |
| `output_schema` | `'text'` 或 `'json'`（附字段定义） | json: `{overseas_diverge, process, dimension_diverge}` |
| `max_len` | 每段/每条长度上限（字） | 60 / 80 |
| `temperature` / `max_tokens` / `timeout` / `retry` | 生成参数（`call_text` 原生支持） | 低 temperature、30s、重试 1 次 |
| `degrade_template` | 模板降级函数（入参同事实清单） | design.md §4.3 |
| `persist` | 落库策略（§六） | `market_daily_review` 三段字段 |
| `advice_allowed` | 是否允许操作建议（默认 `False`） | `False` |

## 四、统一调用契约

```
generate(scene_id, context, trade_date, biz_key=None) -> GeneratedComment

1. facts = scene.facts_builder(context)      # 规则产出事实清单；无事实 → 直接返回 None（不调 LLM）
2. adapter 不可用（is_available 为 False）→ 直接走 degrade_template
3. 组装 messages（system = prompt_template + few_shot，user = facts JSON）
   → LLMToolAdapter.call_text(temperature, max_tokens, timeout)
4. 按 output_schema 解析并校验：必填字段、长度上限；失败重试 1 次，再失败 → degrade_template
5. 返回 GeneratedComment，并按 scene.persist 落库
```

`GeneratedComment` 统一结构（落库与前端消费的稳定契约）：

```json
{
  "scene": "sentiment.review",
  "trade_date": "2026-09-25",
  "items": {"overseas_diverge": "...", "process": "...", "dimension_diverge": ""},
  "source": "llm",
  "model": "...",
  "generated_at": "...",
  "latency_ms": 1234
}
```

`source` 取值 `'llm' | 'rule'`；`items` 结构遵循各场景 `output_schema`（单段场景为 `{"text": "..."}`）。

## 五、保护栏（所有场景强制）

1. **数字幻觉约束**：只允许引用事实清单中出现的数字与日期，禁止推算新数字（prompt 约束；facts 是唯一注入通道，prompt 不再拼接其它数字来源）。
2. **默认禁止买卖建议**：`advice_allowed=False`；仅显式声明的场景可给"状态应对提示"（如退潮标签 → 忌打板接力），且应对动作必须由规则触发的条件决定，禁止个股推荐。
3. **永不阻断主流程**：超时 30s、失败重试 1 次、再失败模板降级；任何异常只降级、不抛出。
4. **来源标记**：结果必带 `source`，前端以角标区分"AI 生成 / 规则生成"。
5. **成本控制**：同 `scene + trade_date + biz_key` 只生成一次（唯一键幂等 upsert，手动重跑采集时覆盖）；失败次日盘前补采；多段文案合并一次调用（如 `sentiment.review` 三段一次出）。

## 六、存储策略

| 策略 | 适用 | 示例 |
|---|---|---|
| 写业务表字段 | 场景有自然归属表 | `market_daily_review.process_text` / `overseas_text` / `dim_diverge_text`（auto-review v1 采用） |
| 写通用表 | 无归属表的新场景 | `ai_generated_comment(scene, biz_date, biz_key, content JSON, source, model, generated_at)`，`UNIQUE(scene, biz_date, biz_key)`；页面经业务 API 组装读取 |

表结构在各场景实现时落地（遵循 `platform/storage/storage-migration.md` 的 create_all 只增不改），本文只定契约。

## 七、场景清单（盘点）

| scene_id | 页面位置 | 生成时机 | 现状 |
|---|---|---|---|
| `sentiment.overseas_diverge` | 外盘卡 · 背离盒 | 收盘采集 | auto-review M1/M2（design.md） |
| `sentiment.process` | 情绪演化 · 主轴 | 收盘采集 | auto-review M1/M2；当前为前端规则拼接 |
| `sentiment.dim_diverge` | 双维度卡 · 背离盒 | 收盘采集 | auto-review M1/M2 |
| `sentiment.tip_short` / `sentiment.tip_trend` | 短线/趋势情绪卡 💡 tip | 收盘采集 | 新增场景（mockup：「退潮：忌打板接力，等空间板企稳」「偏多：可持仓趋势股，等放量突破再加仓」）；规则给阶段标签与条件，LLM 给一句话；`advice_allowed=True`（仅状态应对，见 §五.2） |
| `tomorrow.preview` | 明日重点 ai_preview | 收盘采集 | 已有规则拼装实现（`generate_tomorrow_focus`），M2 迁移为场景 |
| `focus.stock_reason` | 个股入选理由 | 分析任务尾部 | 已有实现，迁移候选 |
| `expectation.eval` | 预期管理评价 | 复盘触发 | 独立端点已设计（expectation-management.md），不强迁；**此后新增场景一律走本接口** |
| `growth.review_advice` | 交易成长复盘建议 | 复盘触发 | 规划中，直接走本接口 |

## 八、与 auto-review 的关系

[design.md](design.md) §四 的 LLM 生成 = 本接口的首个场景 **`sentiment.review`**（三段合并一次调用）。规则引擎（design.md §三）继续负责"要不要说、说什么数字"；本接口负责"怎么说 + 校验 + 降级 + source 标记 + 落库"。design.md 的 §4.2 prompt 即该场景的 `prompt_template`，§4.3 模板即 `degrade_template`。

## 九、分期与开放问题

- 实现节奏：与 auto-review M2 同期实现 runner（注册表 + `generate` + 校验 + 降级 + 幂等落库），`sentiment.review` 首个接入；`sentiment.tip_*` 第二批；存量场景（tomorrow.preview 等）按需迁移。

1. **校验强度**：是否做"数字白名单回查"（输出中出现的数字必须 ∈ facts）——v1 仅 prompt 约束 + 人工抽查，v2 可加自动回查。
2. **结构化输出**：`LLMToolAdapter.call_text` 已支持 `temperature/max_tokens/timeout`，但未透传 `response_format`；先用严格 JSON prompt + 解析失败重试兜底（与 design.md §八.4 同一问题，收敛到此处跟踪）。
3. **tip 场景的建议边界**：`sentiment.tip_*` 允许"应对提示"是否可接受，需评审确认；若否，退化为纯状态描述。
