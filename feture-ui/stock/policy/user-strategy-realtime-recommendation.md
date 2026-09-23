# 用户自定义策略 + 实时 AI 推荐板块/个股 设计方案

> 生成日期：2026-09-22
> 目标：用户能自定义策略 → 决策信号经过该策略 → AI 实时推荐「板块 + 个股」。
> 前置：本目录 `../决策信号/decision-signal.md`（决策信号逻辑）、`../决策信号/owner-signal.md`（用户自有信号）、`../../server/data-source/realtime-data-plan.md`（实时数据方案）。
> 现状代码：`strategies/*.yaml`（自然语言策略）、`src/agent/skills/`（引擎/路由/调度）、`src/storage.py` 的 `decision_signals` 表。

---

## 一、一句话核心思路

把现在「**单只股票 → 选 3 个策略 → 出一个决策信号**」的能力，扩展为「**一个候选池（全A/自选/涨停池/热点板块）→ 用户的策略集 → 批量出信号 → 按板块聚合 → 实时排序推荐板块和个股**」。

关键区别：现有策略是「给一只股票打分」，要的是「给一个市场打分并给出**买什么**」。

---

## 二、现状盘点：已有能力 vs 缺口

| 能力 | 现状 | 是否可复用 | 缺口 |
|---|---|---|---|
| 用户自定义策略 | `strategies/*.yaml` 自然语言策略，`SkillManager` 启动加载 | ✅ 复用 | 策略无「扫描范围/频率/排序」配置，只能评单股 |
| 策略路由 | `SkillRouter.select_skills`：用户指定 → 手动 → 市场状态 → 默认，最多 3 个 | ✅ 复用 | 面向「单股分析」，非「全市场扫描」 |
| 策略并行执行 | `AgentSkillScheduler`（线程池，并发 1~4） | ✅ 复用 | 按「策略」并发，未按「标的批量」并发 |
| 策略聚合 | `StrategyEngine`：分区 → 聚合 → 合成 → 共识信号 | ✅ 复用 | 聚合粒度是「单股多策略」，缺「多股 → 板块」聚合 |
| 决策信号落库 | `decision_signals` 表（action/confidence/score/horizon/进出场价/reason/evidence） | ✅ 复用 | 只有 `stock_code` 维度，无「板块标的」与「策略ID」维度 |
| 信号回测/反馈 | `decision_signal_outcomes` / `decision_signal_feedback` | ✅ 复用 | 缺「策略级」胜率统计闭环 |
| 实时数据 | 见 realtime-data-plan（分钟级东财/AkShare） | ✅ 复用 | 尚无「推荐扫描」消费这些数据 |

结论：**策略引擎（选/跑/聚合/落库）基本齐了，缺的是把「单股评估」循环化成「全市场扫描 + 板块聚合 + 实时推荐」这一层。**

---

## 三、整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                    feture-ui 大盘情绪 / 推荐页                    │
│       (板块 TopN · 个股 TopN · 每条: 策略依据+置信度+性价比)         │
└───────────────────────────────┬──────────────────────────────┘
                                │ SSE / REST (读缓存)
┌───────────────────────────────▼──────────────────────────────┐
│              实时推荐服务 (feture-ui/server，新增)                │
│  · 推荐调度器：盘中分钟级 tick + 盘后快照                          │
│  · 候选池构建 · 分层扫描 · 板块聚合 · 排序 · 落库                  │
└───────┬──────────────────────────────┬───────────────────────┘
        │ 调用策略引擎                   │ 调用数据
┌───────▼──────────────────────────────▼───────────────────────┐
│             复用现有策略引擎 (src/agent/skills)                  │
│  SkillRouter → AgentSkillScheduler → SkillAgent → StrategyEngine │
└───────┬──────────────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────┐
│        数据层 DataFetcherManager（分钟级轮询，见 realtime-data-plan）│
│  涨停池 · 炸板/跌停池 · 涨跌家数 · 板块涨幅 · 全市场快照 · 资金流   │
└──────────────────────────────────────────────────────────────┘
```

---

## 四、三大核心模块详细设计

### 模块 A：用户自定义策略（在现有 YAML 上扩展）

现有 YAML（`strategies/*.yaml`）已能描述「判断标准 + 评分调整」，用户无需写代码。为支持「实时推荐」，给 YAML 增加一个可选 `scan` 段：

```yaml
name: my_dragon_strategy
display_name: 我的龙头低吸策略
description: 板块龙头回调低吸
category: trend
required_tools: [get_realtime_quote, get_sector_rankings, get_limit_up_pool]

# ===== 新增：推荐扫描配置（不填 = 仅用于单股分析，不参与推荐） =====
scan:
  universe: limit_up_pool        # 候选池：all_a | watchlist | limit_up_pool | hot_sector | 板块代码
  filters:                        # 硬性规则粗筛（免费、全量，先于 LLM）
    - price: [5, 200]             # 价格区间
    - turnover: "> 3%"            # 换手率
    - market_cap: "> 50e"         # 市值
  ranking:                        # 排序因子（用于最终排序）
    - confidence                  # 策略置信度
    - limit_up_streak             # 连板高度
    - volume_ratio                # 量能
  output: [sector, stock]         # 输出板块 + 个股
  horizon: short                  # 推荐周期：short(1-3日) / swing(1-2周)

# 原自然语言判断标准不变
instructions: |
  1. 用 get_limit_up_pool 找 2-3 连板龙头，回调 1-2 天且未大跌时低吸。
  2. 用 get_sector_rankings 确认板块仍在涨幅前列。
  3. 量能情绪转好（昨日涨停今日高开）时加分。
  ...
```

用户侧体验（feture-ui）：
- 「策略库」页：可视化新建/编辑策略（表单 + 自然语言描述，底层仍存 YAML）。
- 每个策略有开关：`参与实时推荐 / 仅用于单股分析`。
- 支持绑定「自选股池」作为 `universe: watchlist`。

### 模块 B：决策信号流经策略（复用 + 扩展字段）

现有链路已完整，直接复用：

```
策略 YAML → SkillAgent(system_prompt 注入策略 instructions)
         → 输出 JSON {skill_id, signal, confidence, conditions_met/missed,
                       score_adjustment, reasoning}
         → AgentOpinion → StrategyEngine 聚合 → 共识信号
         → DecisionSignalRecord 落库
```

需要扩展的点（`decision_signals` 表 / `AgentContext`）：

1. **标的类型**：`stock_code` 之外增加 `target_type`（`stock` / `sector`），板块推荐时 `stock_code` 存板块代码。
2. **策略溯源**：`source_agent` 记录 `skill:<id>`，`metadata_json` 追加 `skill_id`，让每个信号能回溯到「哪个策略触发」。
3. **推荐快照关联**：`metadata_json` 追加 `recommendation_id`，把信号与某次扫描快照绑定，便于回测。

决策信号落库字段（现状已有，直接可承载）：
`action / confidence / score / horizon / entry_low-high / stop_loss / target_price / reason / evidence_json / decision_profile / market_phase`。

### 模块 C：实时推荐扫描循环（**新增核心**）

一个后台调度器（`recommendation_service`），盘中分钟级、盘后快照：

```
每 N 分钟 tick（盘中 2~5min，与数据轮询对齐）：
┌─ 1. 数据快照：复用 DataFetcherManager（涨停池/涨跌家数/板块涨幅/全市场 spot）
├─ 2. 候选池构建：
│     union(各激活策略的 scan.universe) → 去重
│     典型规模：涨停池 ~几十只 / 热点板块成分 ~几百只 / 自选 ~几十只
├─ 3. 分层扫描（成本控制关键）：
│     3a. 规则粗筛（本地、免费、全量）：跑 scan.filters → 砍到 Top N（如 50 只）
│     3b. LLM 精评（仅 Top N）：复用 AgentSkillScheduler 并发跑各策略
│         SkillAgent 逐只出决策信号
├─ 4. 信号聚合（复用 StrategyEngine）：
│     每只股票：多策略信号 → 加权共识分数 + 共识信号
├─ 5. 板块聚合（新增）：
│     个股信号按「所属行业/概念」聚合 → 板块温度 = Σ(个股得分 × 权重)
│     板块内涨停家数/连板高度/资金流 → 板块强弱
├─ 6. 排序输出：
│     板块 Top N（按温度）+ 个股 Top N（按共识分）
│     每条附带：策略依据（哪些策略命中）、置信度、性价比（entry vs stop/target）
├─ 7. 落库 + 推送：
│     写入 recommendation_snapshot / recommendation_item（见下）
│     通过 SSE 推送到 feture-ui，前端实时刷新
└─ 8. 盘后快照：15:30 存当日推荐 + 情绪轨迹，供「近 N 日」回看
```

---

## 五、交互与反馈闭环（让 AI 更懂你）

1. **主动推送**：盘中推荐刷新时，SSE 推送「新上榜 / 掉榜 / 信号变化」。
2. **对话触发**：`/ask 用我的龙头策略扫一下今天的板块` → 触发一次即时扫描。
3. **用户反馈**：每条推荐可点「采纳 / 忽略 / 收藏」，写入 `decision_signal_feedback`。
4. **策略自学习（阶段 3）**：
   - 统计每个策略的「命中胜率」（对接 `decision_signal_outcomes` 前向验证）。
   - 命中率高的策略在聚合时权重上调；连续失效的策略提示用户降权/停用。
   - 结合 `../决策信号/decision-signal.md` 的「情绪一致性打分」，AI 反向给用户的操作习惯打分。

---

## 六、成本控制（免费源 + LLM 约束下的关键设计）

> 不能对全市场 5000 只逐只跑 LLM。

| 手段 | 说明 |
|---|---|
| 候选池裁剪 | 只在「涨停池 / 热点板块成分 / 自选股」上跑，天然几十~几百只 |
| 分层扫描 | 规则粗筛（免费、全量）→ LLM 精评（只对 Top N） |
| 短 TTL 缓存 | 同一分钟同策略同标的信号复用，避免重复调用 |
| 结果缓存 | 前端只读「最近一次扫描快照」缓存，不重复触发 LLM |
| 异步 + 节流 | 后台线程池，分钟级 tick；数据层受东财限流（2~5s），聚合多接口 + 熔断 |
| 降级 | 数据源故障时，用最近一次快照 + 标注「数据延迟」；规则层结果仍可出 |

---

## 七、数据模型（新增表，SQLite）

| 表 | 用途 | 关键字段 |
|---|---|---|
| `user_strategies` | 用户策略实例（策略 + 用户激活/参数覆盖） | user_id, skill_id, enabled, scan_config_json, weight |
| `recommendation_snapshot` | 每次扫描快照 | id, scan_time, universe, status, market_phase, source_skills |
| `recommendation_item` | 推荐条目（板块 or 个股） | snapshot_id, target_type, code, name, sector, score, signal, confidence, reason, entry/stop/target, rank, evidence_json |
| `strategy_performance` | 策略级表现（回测/胜率） | skill_id, window, hit_rate, avg_return, sample_size |

决策信号本身沿用 `decision_signals`（扩展 `target_type` + `skill_id`），不再新建表。

---

## 八、分阶段落地

| 阶段 | 内容 | 实时程度 |
|---|---|---|
| 阶段 1（MVP） | 复用现有引擎，把「单股评估」循环化：每日盘前/盘中定时对「自选池 + 涨停池」扫描 → 生成板块/个股推荐，写 SQLite，前端轮询 | 盘中分钟级（定时） |
| 阶段 2 | 接入分钟级轮询 + SSE 推送 + 盘中增量扫描（只扫变化标的，上榜/掉榜提示） | 盘中准实时 |
| 阶段 3 | 用户策略库可视化、反馈闭环、策略级胜率回测、权重自适应、付费源亚秒级 | 个性化 + 更实时 |

---

## 九、需要新增/补齐的代码

1. **策略扫描配置**（`strategies/*.yaml` + `src/agent/skills/base.py`）：
   - `Skill` 定义增加可选 `scan` 字段（universe/filters/ranking/output/horizon）解析。
2. **推荐服务**（`feture-ui/server` 或 `src/recommendation/`）：
   - `RecommendationScheduler`：分钟级 tick + 盘后快照。
   - `CandidatePoolBuilder`：候选池构建。
   - `LayeredScanner`：规则粗筛 → LLM 精评（调用现有 SkillAgent/Scheduler）。
   - `SectorAggregator`：个股信号 → 板块温度聚合。
   - `Recommender`：排序 + 性价比计算 + 落库。
3. **存储**（`src/storage.py`）：
   - 新增 4 张表（见上）+ `decision_signals` 增加 `target_type` 列迁移。
4. **API + 推送**（`feture-ui/server`）：
   - REST 读推荐快照 + SSE 推送更新（不经过 agent 工具文本链路，直接 Pydantic JSON）。
5. **前端**（`feture-ui`）：
   - 策略库页（可视化编辑 YAML）+ 推荐页（板块/个股榜单，红涨绿跌）。

---

## 十、一句话总结

复用现有「YAML 策略 + SkillRouter/Scheduler/StrategyEngine + decision_signals」链路，把「单股评估」循环化成「**候选池 → 分层扫描 → 板块聚合 → 实时排序推荐**」，即可让用户自定义策略驱动 AI 实时推荐板块和个股；成本和实时性靠「候选池裁剪 + 规则粗筛 + 分钟级轮询 + 结果缓存」兜底。
