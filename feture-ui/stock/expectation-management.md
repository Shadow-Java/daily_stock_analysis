# 预期管理系统设计文档

> 版本: v0.1 草稿
> 日期: 2026-09-18
> 状态: 待评审

---

## 一、背景与目标

### 1.1 问题陈述

当前 DSA 系统已有 AI 驱动的 `DecisionSignal`（决策信号）能力，能够对个股做出买卖建议。但缺少一个闭环机制来记录用户**自己**的判断、操作预期，并在收盘后做系统性复盘。用户每天面对大量信息，无法沉淀自己的判断质量、识别认知偏差模式。

### 1.2 核心目标

1. **每日预期录入**：结合当天新闻/事件，记录用户对次日行情和操作的判断。
2. **收盘自动评分**：收盘后系统自动对预期的方向、幅度进行量化评分。
3. **用户自我复盘**：用户填写执行情况与反思，形成主观+客观双轨记录。
4. **Agent 评价**：AI Agent 对用户的预期质量、推理逻辑、历史模式给出周期性点评与改进建议。

### 1.3 与现有系统的关系

```
AI DecisionSignal ──参考──► 用户预期录入
                              │
                              ▼
               新闻/事件上下文 + 用户判断
                              │
                     收盘后自动评分引擎
                              │
                    用户自我复盘 + Agent 评价
                              │
                        预期准确率统计
```

预期管理系统是对 `DecisionSignal` 的**用户侧镜像**，两者互不依赖，但可以交叉参考（例如：用户预期与 AI 信号是否一致，最终结果如何）。

---

## 二、核心概念定义

| 概念 | 说明 |
|------|------|
| **UserExpectation**（预期记录） | 用户在某一天录入的、针对次日或未来某时段的判断与操作计划 |
| **ExpectationOutcome**（结果记录） | 收盘后系统自动计算的量化结果 + 用户填写的自我复盘 |
| **ExpectationAgentEval**（Agent 评价） | AI Agent 对用户预期质量、推理逻辑、历史规律的周期性评价 |
| **市场背景快照** | 预期录入时系统自动抓取的新闻摘要、关键事件、市场情绪指标 |

---

## 三、数据模型

### 3.1 UserExpectation（用户预期）

```
UserExpectation
├── id                    UUID，主键
├── target_date           Date，预期针对的交易日（通常为录入日+1个交易日）
├── created_at            DateTime，录入时间
├── updated_at            DateTime
├── market                Enum: cn / hk / us
│
├── ── 市场背景（录入时快照）──
├── context_snapshot      JSON，包含：
│   ├── news_highlights   List[str]，当日重要新闻标题（最多5条）
│   ├── key_events        List[str]，关键事件（财报/政策/重要时点）
│   ├── sentiment         Enum: positive / neutral / negative
│   └── ai_signal_summary str，当日 AI DecisionSignal 摘要（可选，系统自动填充）
│
├── ── 大盘预期 ──
├── index_direction       Enum: up / flat / down，大盘方向判断
├── index_magnitude       Enum: strong / moderate / weak，幅度判断
├── index_reasoning       Text，大盘判断理由（自由文字，必填）
│
├── ── 个股预期列表 ──
├── stock_expectations    JSON List[StockExpectation]
│   └── StockExpectation:
│       ├── stock_code    str
│       ├── action        Enum: buy / sell / add / reduce / hold / watch
│       ├── direction     Enum: up / flat / down
│       ├── target_price  float | null
│       ├── stop_loss     float | null
│       ├── confidence    int 1–5
│       └── reasoning     Text，判断理由（必填）
│
├── ── 综合判断 ──
├── key_risks             Text，录入时认为最重要的风险点
├── operation_plan        Text，明日具体操作计划（什么情况开仓/加仓/离场）
├── overall_confidence    int 1–5，整体信心指数
└── tags                  List[str]，自定义标签（如"政策驱动"/"财报季"/"恐慌盘"）
```

### 3.2 ExpectationOutcome（预期结果）

```
ExpectationOutcome
├── id                    UUID，主键
├── expectation_id        FK → UserExpectation
├── outcome_date          Date，收盘日期
├── scored_at             DateTime，评分计算时间
│
├── ── 系统自动评分 ──
├── auto_score            float 0–100，综合自动评分
├── index_score           JSON，大盘方向评分细节
│   ├── direction_hit     bool，方向是否正确
│   ├── magnitude_hit     bool，幅度是否吻合
│   └── index_return      float，实际指数涨跌幅
├── stock_scores          JSON List[StockScore]
│   └── StockScore:
│       ├── stock_code    str
│       ├── direction_hit bool
│       ├── actual_return float，实际涨跌幅
│       ├── target_reached bool | null（若有目标价）
│       └── score         float 0–100
│
├── ── 用户自我复盘（收盘后填写）──
├── self_score            int 0–100 | null，用户自评分
├── execution_status      Enum: executed / partial / not_executed | null
├── execution_notes       Text | null，执行情况说明（实际做了什么）
├── deviation_reason      Text | null，未按计划执行的原因
├── lessons               Text | null，复盘总结与经验
└── filled_at             DateTime | null，用户填写时间
```

### 3.3 ExpectationAgentEval（Agent 评价）

```
ExpectationAgentEval
├── id                    UUID
├── expectation_id        FK → UserExpectation（单条评价）或 null（周期性评价）
├── eval_type             Enum: single（单条） / weekly（周报） / monthly（月报）
├── eval_date             Date，评价日期
├── generated_at          DateTime
│
├── ── 单条评价维度 ──
├── reasoning_quality     int 1–5，推理逻辑质量
├── information_usage     int 1–5，信息利用完整性
├── risk_awareness        int 1–5，风险意识
├── execution_alignment   int 1–5，预期与实际执行一致性（需有 Outcome）
│
├── ── 评价文本 ──
├── overall_assessment    Text，综合点评
├── strengths             List[str]，本次预期的优点
├── weaknesses            List[str]，本次预期的不足
├── pattern_insights      Text | null，结合历史记录识别的行为模式
├── improvement_suggestions List[str]，具体改进建议
│
└── ── 周期性报告额外字段 ──
    ├── period_start      Date
    ├── period_end        Date
    ├── accuracy_trend    JSON，准确率趋势数据
    └── top_patterns      List[str]，周期内主要行为模式总结
```

---

## 四、系统流程

### 4.1 每日预期录入流程

```
T 日（收盘前任意时间）
         │
         ▼
[系统]  自动加载当日市场背景快照
   - 新闻摘要（接现有 news 数据链路）
   - 当日 AI DecisionSignal 参考（可选显示）
   - 关键事件日历（财报/股东大会等）
         │
         ▼
[用户]  填写预期表单
   - 大盘方向 + 幅度 + 理由（必填）
   - 个股预期（可选，0 到 N 条）
   - 关键风险 + 操作计划 + 信心指数
         │
         ▼
[系统]  保存 UserExpectation，
        target_date = 下一交易日
```

### 4.2 收盘自动评分流程

```
T+1 日收盘后（触发条件：交易时段结束 + 行情数据可用）
         │
         ▼
[系统]  查找 target_date = T+1 的所有 UserExpectation
         │
         ▼
[系统]  获取 T+1 日行情数据（接现有 data_provider 链路）
         │
         ▼
[系统]  计算各维度评分：
   - 大盘方向评分（40分）
     * 方向正确: +25 分
     * 幅度吻合（误差 < 0.5%）: +15 分
   - 个股方向评分（60分，等权平均）
     * 每股方向正确: +60%
     * 若有目标价且触达: 额外 +20%（最高100）
         │
         ▼
[系统]  写入 ExpectationOutcome（系统评分部分）
         │
         ▼
[通知]  推送"收盘复盘提醒"给用户（接现有通知链路）
```

### 4.3 用户自我复盘流程

```
T+1 日收盘后
         │
         ▼
[用户]  打开复盘页，查看自动评分明细
         │
         ▼
[用户]  填写自我复盘：
   - 执行状态（按计划 / 部分 / 未执行）
   - 执行说明（实际操作了什么）
   - 未按计划的原因（如有）
   - 复盘总结与经验
   - 自评分
         │
         ▼
[系统]  更新 ExpectationOutcome（自我复盘部分）
         │
         ▼
[可选]  触发单条 Agent 评价生成
```

### 4.4 Agent 评价流程

```
触发条件（任一）：
   A. 用户手动点击"获取 Agent 点评"
   B. 每周日收盘后定时触发周报
   C. 每月最后交易日触发月报
         │
         ▼
[Agent] 读取上下文：
   - 目标预期记录（单条或周期内全部）
   - 对应 Outcome（含自我复盘）
   - 历史 ExpectationAgentEval 摘要（最近3次）
   - 市场背景快照
         │
         ▼
[Agent] 多维度评价：
   1. 推理逻辑质量（信息是否充分利用，逻辑是否清晰）
   2. 信息利用完整性（是否考虑了关键事件/风险）
   3. 风险意识（止损设置、风险提示是否合理）
   4. 预期与执行一致性（说到做到的程度）
   5. 历史模式识别（反复出现的认知偏差）
         │
         ▼
[Agent] 输出评价报告，写入 ExpectationAgentEval
```

---

## 五、界面设计

### 5.1 页面结构（Web 端）

```
/expectations
├── /expectations/new          每日预期录入页
├── /expectations              历史预期列表页
├── /expectations/:id          预期详情 & 复盘页
└── /expectations/stats        统计分析页
```

### 5.2 每日预期录入页 `/expectations/new`

```
┌─────────────────────────────────────────────────────────┐
│  📅 2026-09-19 预期  [今日市场背景]                      │
├─────────────────────────────────────────────────────────┤
│  市场背景快照（只读，系统自动加载）                        │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 📰 关键新闻（3条）                               │    │
│  │ 📅 明日关键事件：FOMC 会议纪要                   │    │
│  │ 🤖 AI 信号参考：沪深300 中性 | AAPL 看多         │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  大盘预期（必填）                                        │
│  方向：[▲涨] [━平] [▼跌]    幅度：[强] [中] [弱]        │
│  理由：┌──────────────────────────────────────────┐     │
│        │ 文字输入...                               │     │
│        └──────────────────────────────────────────┘     │
│                                                         │
│  个股预期                                               │
│  ┌───────────────────────────────────────────────────┐  │
│  │ + 添加个股预期                                     │  │
│  │ ┌──────────────────────────────────────────────┐  │  │
│  │ │ 600519 贵州茅台  [买入▼] [▲涨] 目标:1800     │  │  │
│  │ │ 信心：★★★★☆  止损：1650                       │  │  │
│  │ │ 理由：支撑位企稳，量能温和放大                  │  │  │
│  │ └──────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  关键风险：[文字输入]                                    │
│  操作计划：[文字输入]                                    │
│  整体信心：★★★☆☆                                        │
│  标签：[政策驱动] [+ 添加]                               │
│                                                         │
│                      [保存预期]                         │
└─────────────────────────────────────────────────────────┘
```

### 5.3 预期详情 & 复盘页 `/expectations/:id`

```
┌─────────────────────────────────────────────────────────┐
│  📅 2026-09-19 预期详情                                  │
├───────────────────┬─────────────────────────────────────┤
│  我的预期（只读） │  收盘结果                           │
│                   │                                     │
│  大盘: ▲涨 中    │  实际: ▲+0.8%  ✅ 方向正确         │
│  贵州茅台: 买入   │  600519: +1.2%  ✅ 方向正确        │
│  ...              │  ...                                │
│                   │                                     │
│                   │  自动评分: 78 / 100                 │
├───────────────────┴─────────────────────────────────────┤
│  自我复盘（收盘后填写）                                  │
│  执行状态：[按计划✅] [部分] [未执行]                    │
│  执行说明：[文字输入...]                                 │
│  复盘总结：[文字输入...]                                 │
│  自评分：  ★★★★☆                                        │
│  [保存复盘]  [获取 Agent 点评]                           │
├─────────────────────────────────────────────────────────┤
│  🤖 Agent 评价                          [生成/刷新]     │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 推理质量 ●●●●○  信息利用 ●●●○○                  │    │
│  │ 风险意识 ●●●●●  执行一致 ●●●●○                  │    │
│  │                                                  │    │
│  │ 综合评价：本次预期整体逻辑清晰，方向判断准确...   │    │
│  │ 优点：对止损位设置合理，考虑了外围市场因素...     │    │
│  │ 不足：对成交量分析不足，操作计划条件不够具体...   │    │
│  │ 改进建议：1. 增加量价分析维度                    │    │
│  │           2. 操作计划建议写明具体触发条件...      │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### 5.4 历史列表页 `/expectations`

```
┌─────────────────────────────────────────────────────────┐
│  预期记录                    [+ 新建预期]  [📊 统计]    │
├─────────────────────────────────────────────────────────┤
│  本周准确率: 72%   连续命中: 3天   Agent最近评价: ★★★★  │
├─────────────────────────────────────────────────────────┤
│  2026-09-19  大盘:▲  自动:78  自评:80  Agent:✅  [复盘>]│
│  2026-09-18  大盘:━  自动:45  自评:60  Agent:⚠️  [详情>]│
│  2026-09-17  大盘:▼  自动:90  自评:95  Agent:✅  [详情>]│
│  ...                                                    │
└─────────────────────────────────────────────────────────┘
```

### 5.5 统计页 `/expectations/stats`

```
┌─────────────────────────────────────────────────────────┐
│  统计分析                        [近30天 ▼] [导出]      │
├───────────────┬─────────────────────────────────────────┤
│  准确率趋势   │  维度分析                               │
│  [折线图]     │  大盘方向 72%  个股方向 68%             │
│               │  强势预期 55%  弱势预期 80%             │
├───────────────┴─────────────────────────────────────────┤
│  执行一致性: 按计划 65%  部分 25%  未执行 10%            │
├─────────────────────────────────────────────────────────┤
│  🤖 Agent 模式洞察（最新周报摘要）                       │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 主要模式：1. 趋势判断能力强，但反弹判断偏弱      │    │
│  │           2. 止损执行率不足（计划设止损但常不执行）│    │
│  │           3. 周五持仓倾向，周末消息面风险意识弱   │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## 六、Agent 设计

### 6.1 Agent 定位

**ExpectationCoachAgent** —— 用户预期质量教练，不提供具体股票投资建议，只针对用户的**分析过程与认知框架**进行评价。

### 6.2 Agent 输入 Context

```python
class ExpectationEvalContext:
    # 当前评价目标
    expectation: UserExpectation          # 用户的预期记录
    outcome: Optional[ExpectationOutcome] # 结果记录（若已收盘）

    # 历史参考
    recent_evals: List[ExpectationAgentEval]  # 最近3-5次 Agent 评价摘要
    recent_accuracy: dict                      # 最近30天准确率统计

    # 市场背景（评价时）
    context_snapshot: dict                # 预期录入时的市场快照

    # 模式库（周期性评价时）
    historical_patterns: List[str]        # 从历史中识别的行为模式
```

### 6.3 Agent Prompt 结构

```
系统提示（System Prompt）：
你是一个专业的交易心理教练，帮助用户提升市场预期质量和执行纪律。
你的职责是分析用户的预期记录、推理过程和执行情况，识别认知偏差和改进空间。
你不提供具体投资建议，专注于分析过程和思维质量。

评价维度：
1. 推理逻辑质量（1-5）：预期理由是否清晰、有据可查、逻辑自洽
2. 信息利用完整性（1-5）：是否充分利用了市场背景、关键事件信息
3. 风险意识（1-5）：是否设置止损、是否识别了关键风险
4. 执行一致性（1-5）：（有 Outcome 时）实际执行与计划的吻合程度

输出要求：
- 综合评价：2-3句核心评价
- 优点：1-3条具体优点
- 不足：1-3条具体不足（基于实际记录，不过度批评）
- 改进建议：2-3条具体可执行的建议
- 历史模式（周期性评价时）：识别3条以内的行为规律

用户预期记录：
{expectation_json}

市场背景快照：
{context_snapshot}

收盘结果与自我复盘：
{outcome_json}

历史评价摘要：
{recent_evals_summary}
```

### 6.4 Agent API 接口设计

```
POST /api/v1/expectations/{id}/eval
    触发单条 Agent 评价（已有 Outcome 时提供最完整评价）
    Body: { "force_regenerate": bool }

GET  /api/v1/expectations/{id}/eval
    获取某条预期的 Agent 评价（若无则返回 404）

POST /api/v1/expectations/eval/weekly
    触发周期性 Agent 评价
    Body: { "period": "weekly" | "monthly", "end_date": "2026-09-19" }

GET  /api/v1/expectations/eval/weekly
    获取最新周期性评价
    Query: ?type=weekly&limit=5
```

---

## 七、后端实现要点

### 7.1 新增文件清单

```
src/
├── schemas/
│   └── expectation.py               # UserExpectation / Outcome / AgentEval schema
├── repositories/
│   ├── expectation_repo.py          # 基础 CRUD + 查询
│   └── expectation_outcome_repo.py  # Outcome 读写 + 统计查询
├── services/
│   ├── expectation_service.py       # 核心业务逻辑
│   ├── expectation_scorer.py        # 收盘自动评分引擎
│   └── expectation_agent_service.py # Agent 评价触发与存储
api/v1/endpoints/
└── expectations.py                  # FastAPI router
```

### 7.2 评分引擎设计

```python
class ExpectationScorer:
    """收盘后对 UserExpectation 进行量化评分。"""

    INDEX_WEIGHT = 0.40        # 大盘方向占 40 分
    STOCK_WEIGHT = 0.60        # 个股占 60 分（等权）

    def score(
        self,
        expectation: UserExpectation,
        market_data: MarketCloseData,   # 接现有 data_provider
    ) -> ExpectationOutcome:
        index_score = self._score_index(expectation, market_data)
        stock_scores = self._score_stocks(expectation, market_data)
        auto_score = index_score * self.INDEX_WEIGHT + mean(stock_scores) * self.STOCK_WEIGHT
        return ExpectationOutcome(auto_score=auto_score, ...)
```

### 7.3 调度触发（接现有调度链路）

在现有 scheduler / GitHub Actions 中新增：
- **T+1 收盘触发**：市场收盘后约 30 分钟（数据稳定后），批量评分当日到期的预期
- **周日晚**：触发本周 Agent 周报生成

---

## 八、前端实现要点

### 8.1 新增文件清单（apps/dsa-web）

```
src/pages/
└── ExpectationsPage.tsx     # 路由入口 + 列表页
src/components/
├── expectations/
│   ├── ExpectationForm.tsx  # 预期录入表单
│   ├── ExpectationCard.tsx  # 列表卡片
│   ├── OutcomePanel.tsx     # 自动评分展示 + 自我复盘表单
│   └── AgentEvalPanel.tsx   # Agent 评价展示
└── charts/
    └── AccuracyTrendChart.tsx  # 准确率趋势图
src/api/
└── expectations.ts          # API 调用封装
```

### 8.2 路由注册

在 `App.tsx` 中添加：
```tsx
<Route path="/expectations" element={<ExpectationsPage />} />
<Route path="/expectations/new" element={<ExpectationFormPage />} />
<Route path="/expectations/:id" element={<ExpectationDetailPage />} />
<Route path="/expectations/stats" element={<ExpectationStatsPage />} />
```

---

## 九、存储设计

### 9.1 数据库表（SQLite / PostgreSQL，接现有 storage.py）

```sql
-- 用户预期主表
CREATE TABLE user_expectations (
    id           TEXT PRIMARY KEY,
    target_date  DATE NOT NULL,
    market       TEXT NOT NULL DEFAULT 'cn',
    created_at   TIMESTAMP NOT NULL,
    updated_at   TIMESTAMP NOT NULL,
    context_snapshot   JSON,
    index_direction    TEXT NOT NULL,
    index_magnitude    TEXT NOT NULL,
    index_reasoning    TEXT NOT NULL,
    stock_expectations JSON NOT NULL DEFAULT '[]',
    key_risks          TEXT,
    operation_plan     TEXT,
    overall_confidence INTEGER NOT NULL DEFAULT 3,
    tags               JSON NOT NULL DEFAULT '[]'
);

-- 预期结果表（含自我复盘）
CREATE TABLE expectation_outcomes (
    id               TEXT PRIMARY KEY,
    expectation_id   TEXT NOT NULL REFERENCES user_expectations(id),
    outcome_date     DATE NOT NULL,
    scored_at        TIMESTAMP,
    auto_score       REAL,
    index_score      JSON,
    stock_scores     JSON,
    self_score       INTEGER,
    execution_status TEXT,
    execution_notes  TEXT,
    deviation_reason TEXT,
    lessons          TEXT,
    filled_at        TIMESTAMP
);

-- Agent 评价表
CREATE TABLE expectation_agent_evals (
    id               TEXT PRIMARY KEY,
    expectation_id   TEXT REFERENCES user_expectations(id),
    eval_type        TEXT NOT NULL,
    eval_date        DATE NOT NULL,
    generated_at     TIMESTAMP NOT NULL,
    reasoning_quality    INTEGER,
    information_usage    INTEGER,
    risk_awareness       INTEGER,
    execution_alignment  INTEGER,
    overall_assessment   TEXT,
    strengths            JSON,
    weaknesses           JSON,
    pattern_insights     TEXT,
    improvement_suggestions JSON,
    period_start     DATE,
    period_end       DATE,
    accuracy_trend   JSON,
    top_patterns     JSON
);
```

---

## 十、开放问题 / 待决策

| # | 问题 | 选项 | 默认建议 |
|---|------|------|---------|
| 1 | 每日预期是否允许修改（收盘前）？ | 允许 / 仅创建不修改 | 允许修改，但记录修改时间 |
| 2 | 单日是否支持多条预期（如日内+隔夜）？ | 每日一条 / 多条 | 每日一条，通过标签区分 |
| 3 | Agent 使用哪个模型？ | GPT-4o / Claude Sonnet / 现有配置 | 接现有 LLM 配置入口 |
| 4 | 自动评分是否需要用户确认才生效？ | 自动写入 / 用户确认 | 自动写入，用户可查看明细 |
| 5 | 是否需要支持港股/美股预期（不同收盘时间）？ | 仅 A 股 / 多市场 | 先支持 A 股，字段预留 market |
| 6 | Agent 评价频率：按需触发还是自动推送？ | 按需 / 自动 | 单条按需 + 周报自动 |

---

## 十一、MVP 范围（建议首期交付）

**In Scope:**
- [ ] 每日预期录入（大盘 + 最多3只个股）
- [ ] 收盘自动评分（方向维度）
- [ ] 用户自我复盘表单
- [ ] 历史列表 + 详情页
- [ ] 单条 Agent 评价（手动触发）

**Out of Scope（后续迭代）:**
- 目标价幅度评分（需要更精细的数据）
- Agent 周期性报告
- 统计分析页
- 多市场支持
- 预期 vs AI 信号交叉分析
