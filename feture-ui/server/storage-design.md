# 存储设计 — 预期管理 & 大盘情绪页

> 基于 `feture-ui/design/ui-mockup.html`、`storage-audit.md`、`src/storage.py` 现状整理。
> 存储引擎：SQLite（`data/stock_analysis.db`，WAL 模式），与现有 40+ 张表共存。

---

## 一、预期管理页

### 1.1 现有表覆盖情况

| UI 功能 | 现有表 | 覆盖 |
|---|---|---|
| 每日预期录入（心理快照 + 大盘 + 个股） | `user_expectations` | ✅ |
| 收盘自动评分 + 用户自我复盘 | `expectation_outcomes` | ✅ |
| Agent 多维度点评 | `expectation_agent_evals` | ✅ |
| 原则违规检测 + 用户知情豁免记录 | **无** | ❌ 需新增 |
| 反事实分析（"如果按计划执行" / "如果听 AI"） | **无** | ❌ 需新增 |
| 录入时市场背景快照（Step 2 自动加载内容） | **无** | ❌ 需新增 |

---

### 1.2 现有表字段补充说明

#### `user_expectations`

```
id                  INTEGER PK
target_date         DATE UNIQUE        -- 每天只允许一条
market              VARCHAR(8)         -- 'cn' | 'hk' | 'us'
created_at          DATETIME
updated_at          DATETIME

-- Step 1 心理快照
emotion_index       INTEGER            -- 1~10，1=极度恐惧，10=极度贪婪
decision_drivers    TEXT               -- JSON: ["data","news","gut","follow","position","impulse"]
research_time       VARCHAR(16)        -- 'lt_30m' | '30_90m' | 'gt_90m'
interference_flags  TEXT               -- JSON: ["loss_streak","overconfident","concentration","fomo"]

-- Step 3 大盘预期
index_direction     VARCHAR(8)         -- 'up' | 'flat' | 'down'
index_magnitude     VARCHAR(16)        -- 'strong'(>1%) | 'moderate'(0.3-1%) | 'weak'(<0.3%)
index_reasoning     TEXT               -- 判断理由（必填）
key_assumptions     TEXT               -- JSON: ["假设1", "假设2"]

-- Step 4 个股预期（JSON 数组，字段见 §1.3）
stock_expectations  TEXT               -- JSON array

-- Step 5 综合判断
key_risks           TEXT               -- 关键风险
operation_plan      TEXT               -- 操作计划
overall_confidence  INTEGER            -- 1~5 星
tags                TEXT               -- JSON: ["政策驱动", "技术面"]
```

#### `expectation_outcomes`

```
id                  INTEGER PK
expectation_id      INTEGER FK → user_expectations.id (CASCADE)
outcome_date        DATE
scored_at           DATETIME

-- 自动评分（收盘后批量计算）
auto_score          FLOAT              -- 0~100，加权综合分
index_score_detail  TEXT               -- JSON: {direction_hit, magnitude_hit, actual_chg_pct, points}
stock_scores        TEXT               -- JSON: [{code, direction_hit, actual_chg_pct, points}]

-- 用户自我复盘
self_score          INTEGER            -- 1~5 星（用户主观）
execution_status    VARCHAR(16)        -- 'executed' | 'partial' | 'not_executed'
execution_notes     TEXT               -- 执行说明
deviation_reason    TEXT               -- 偏差原因
assumption_reviews  TEXT               -- JSON: [{text, result: 'hit'|'miss'|'na'}]
lessons             TEXT               -- 复盘总结
filled_at           DATETIME
```

#### `expectation_agent_evals`

```
id                  INTEGER PK
expectation_id      INTEGER FK → user_expectations.id (CASCADE)
eval_type           VARCHAR(16)        -- 'single' | 'weekly'
eval_date           DATE
generated_at        DATETIME

-- 评分维度（1~5）
reasoning_quality       INTEGER
information_usage       INTEGER
risk_awareness          INTEGER
execution_alignment     INTEGER        -- 仅有 outcome 后才有意义

-- 评价内容
overall_assessment      TEXT
strengths               TEXT           -- JSON list
weaknesses              TEXT           -- JSON list
improvement_suggestions TEXT           -- JSON list
bias_tags               TEXT           -- JSON: ["过度自信","锚定效应","确认偏误"]
```

---

### 1.3 `stock_expectations` JSON 结构（`user_expectations` 内嵌）

每条个股预期是一个对象，完整字段：

```json
{
  "code": "600519",
  "name": "贵州茅台",
  "action": "buy",            // "buy" | "sell" | "hold"
  "direction": "up",          // "up" | "flat" | "down"
  "target_price": 1800,
  "stop_loss": 1650,
  "confidence": 4,            // 1~5 星
  "reasoning": "支撑位企稳…",
  "key_assumptions": ["同行业龙头已企稳，板块联动效应会传导"],
  "principle_violations": [
    {
      "principle_id": 1,
      "principle_text": "不在周五下午开新仓",
      "user_decision": "override",    // "override" | "comply"
      "override_reason": "节前行情特殊，有仓位计划"
    }
  ]
}
```

---

### 1.4 新增表：`user_trading_principles`

存储用户自定义的交易原则库，用于录入预期时实时检测违规。

```sql
CREATE TABLE user_trading_principles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT    NOT NULL DEFAULT 'default',   -- 多用户预留
  rule_text    TEXT    NOT NULL,                     -- "不在周五下午开新仓"
  rule_scope   TEXT,                                 -- JSON: 触发范围描述（自然语言或结构化）
  is_active    INTEGER NOT NULL DEFAULT 1,           -- 0=停用
  violation_count INTEGER NOT NULL DEFAULT 0,        -- 累计违规次数（冗余缓存）
  created_at   DATETIME NOT NULL,
  updated_at   DATETIME NOT NULL
);
```

---

### 1.5 新增表：`counterfactual_analysis`

存储复盘时的反事实推演结果（"如果按计划执行" / "如果采纳 AI"）。

```sql
CREATE TABLE counterfactual_analysis (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  expectation_id  INTEGER NOT NULL REFERENCES user_expectations(id) ON DELETE CASCADE,
  scenario        TEXT    NOT NULL,   -- 'full_execution' | 'follow_ai' | 'custom'
  scenario_label  TEXT    NOT NULL,   -- "如果完全按计划执行（开盘买入100股）"
  result_pct      FLOAT,              -- 情景收益率
  result_label    TEXT,               -- "执行问题，不是判断问题"
  detail          TEXT,               -- JSON: 详细计算过程
  generated_at    DATETIME NOT NULL,

  UNIQUE(expectation_id, scenario)
);
```

---

### 1.6 新增表：`expectation_market_context`

保存录入预期时 Step 2「今日市场背景」的快照，防止新闻/AI 信号事后变动影响复盘还原。

```sql
CREATE TABLE expectation_market_context (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  expectation_id  INTEGER NOT NULL REFERENCES user_expectations(id) ON DELETE CASCADE UNIQUE,
  snapshot_date   DATE    NOT NULL,
  key_news        TEXT,              -- JSON: ["新闻1", "新闻2"]
  key_events      TEXT,              -- JSON: [{date, desc}]，明日关键事件
  ai_signals      TEXT,              -- JSON: [{code, name, signal: 'bull'|'neutral'|'bear'}]
  created_at      DATETIME NOT NULL
);
```

---

### 1.7 预期管理页 API 读写路径

| 操作 | 读/写 | 涉及表 |
|---|---|---|
| 预期列表页（本周概况、连续命中、录入完整度、Agent 评级） | 读 | `user_expectations` + `expectation_outcomes` + `expectation_agent_evals` |
| 录入预期 Step 1~5 保存 | 写 | `user_expectations` + `expectation_market_context` |
| 原则检查（实时） | 读 | `user_trading_principles` |
| 收盘后自动评分 | 写 | `expectation_outcomes` |
| 复盘填写 | 写 | `expectation_outcomes`（更新） |
| 获取 Agent 点评 | 写 | `expectation_agent_evals` |
| 反事实分析生成 | 写 | `counterfactual_analysis` |

---

---

## 二、大盘情绪页

### 2.1 现有表覆盖情况

| UI 功能 | 现有表 | 覆盖 |
|---|---|---|
| 指数行情（沪深 300/上证/创业板） | `stock_daily` + `data_provider/` 实时接口 | ✅ 实时可取，历史在 `stock_daily` |
| 双维度情绪温度历史轨迹（近 N 日） | **无** | ❌ 需新增 |
| 两市成交额历史轨迹 | **无** | ❌ 需新增（`stock_daily` 无市场聚合级别） |
| 涨跌家数历史 | **无** | ❌ 需新增 |
| 涨停梯队历史（首板/二板/三板/炸板） | **无** | ❌ 需新增 |
| 市场聚焦 — 周热点事件 | **无** | ❌ 需新增 |
| 市场聚焦 — 焦点个股 | **无** | ❌ 需新增 |
| 市场聚焦 — 热点板块历史 | **无** | ❌ 需新增 |
| 明日重点（明日关键事件/关注板块/关注个股/AI 前瞻） | **无** | ❌ 需新增 |
| 外盘情绪（美股/韩股主要指数） | 无持久化，`yfinance_fetcher` 实时 | ⚠️ 实时可取，历史缺轨迹 |

---

### 2.2 新增表：`market_daily_snapshot`

**每日 15:30 采集一次**，是大盘情绪所有时间轴的底表。

```sql
CREATE TABLE market_daily_snapshot (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_date      DATE    NOT NULL UNIQUE,   -- 交易日，YYYY-MM-DD

  -- 两市量能
  total_amount    REAL,              -- 两市合计成交额（亿元）
  sh_amount       REAL,              -- 沪市成交额（亿元）
  sz_amount       REAL,              -- 深市成交额（亿元）
  amount_vs_prev  REAL,              -- 较前日变化率（%），正=放量，负=缩量

  -- 涨跌统计
  up_count        INTEGER,           -- 上涨家数
  down_count      INTEGER,           -- 下跌家数
  flat_count      INTEGER,           -- 平盘家数
  limit_up_count  INTEGER,           -- 涨停家数（封板有效）
  limit_down_count INTEGER,          -- 跌停家数
  blown_count     INTEGER,           -- 炸板家数
  blown_rate      REAL,              -- 炸板率 = blown / (limit_up + blown)，%

  -- 双维度情绪温度（0~100）
  -- 短线温度：基于涨停/炸板/梯队/题材热度
  sentiment_st    INTEGER,           -- 短线情绪温度
  -- 趋势温度：基于指数趋势/量能/主力净流入/两融
  sentiment_trend INTEGER,           -- 趋势情绪温度

  -- 主力净流入（亿元）
  main_inflow     REAL,              -- 全市场主力净流入（正=净买入）
  north_inflow    REAL,              -- 北向资金净流入（亿元）

  -- 指数收盘（冗余缓存，方便情绪页直接查）
  hs300_close     REAL,
  hs300_chg_pct   REAL,
  sh50_chg_pct    REAL,
  chinext_chg_pct REAL,              -- 创业板

  -- 60日新高新低
  new_high_60d    INTEGER,           -- 近60日新高家数
  new_low_60d     INTEGER,           -- 近60日新低家数

  -- 外盘摘要（JSON，仅收盘后更新）
  -- {"spx_chg":0.3,"ndx_chg":0.5,"vix":18.2,"sox_chg":1.1,"kospi_chg":-0.2}
  overseas_summary TEXT,

  -- 快照状态
  is_complete     INTEGER NOT NULL DEFAULT 0,  -- 1=15:30后完整快照，0=盘中或未采集
  collected_at    DATETIME
);

CREATE INDEX idx_mds_trade_date ON market_daily_snapshot(trade_date);
```

---

### 2.3 新增表：`market_limit_ladder_snapshot`

**每日 15:30 采集涨停梯队状态**，支持「涨停梯队演化」区的历史轨迹。

```sql
CREATE TABLE market_limit_ladder_snapshot (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_date      DATE    NOT NULL UNIQUE,

  -- 各高度板家数
  height_1        INTEGER,           -- 首板家数
  height_2        INTEGER,           -- 二板家数
  height_3        INTEGER,           -- 三板家数
  height_4        INTEGER,           -- 四板家数
  height_5plus    INTEGER,           -- 五板及以上家数

  -- 最高板高度 & 龙头代码
  max_height      INTEGER,           -- 当日空间最高板数
  max_height_code TEXT,              -- 空间板个股代码
  max_height_name TEXT,

  -- 梯队完整度（五板 → 四板 → 三板 → 二板 → 首板是否完整）
  ladder_complete INTEGER,           -- 1=完整，0=断层

  -- 首封时间分布（JSON）
  -- {"925": 5, "930": 12, "1000": 8, "1100": 6, "1400": 3}
  first_seal_dist TEXT,

  -- 板块分布 Top5（JSON）
  -- [{"sector": "固态电池", "count": 5}, ...]
  sector_dist     TEXT,

  -- 昨日涨停板今日表现
  prev_limit_up_total  INTEGER,      -- 昨日涨停板家数
  prev_limit_up_again  INTEGER,      -- 今日继续涨停
  prev_limit_up_blown  INTEGER,      -- 今日炸板
  prev_limit_up_down   INTEGER,      -- 今日下跌

  collected_at    DATETIME
);
```

---

### 2.4 新增表：`market_focus_events`

存储「市场聚焦演化 — 周聚焦 / 月聚焦」中的热点事件卡片。

```sql
CREATE TABLE market_focus_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_date      DATE    NOT NULL,              -- 事件发生日期
  scope           TEXT    NOT NULL,              -- 'week' | 'month'

  -- 事件主体
  title           TEXT    NOT NULL,              -- "宁德时代宣布新一轮欧洲建厂计划"
  source          TEXT,                          -- 来源（媒体/公告）
  event_type      TEXT,                          -- 'policy'|'earnings'|'news'|'macro'|'block'
  sentiment       TEXT,                          -- 'positive'|'negative'|'neutral'

  -- 关联板块/个股（JSON）
  related_sectors TEXT,                          -- JSON: ["新能源", "固态电池"]
  related_stocks  TEXT,                          -- JSON: ["600519", "300424"]

  -- 影响评估
  impact_label    TEXT,                          -- "催化板块上涨" / "短期利空"
  impact_magnitude TEXT,                         -- 'high'|'medium'|'low'

  -- 内容
  summary         TEXT,                          -- 事件摘要（展示在卡片上）

  created_at      DATETIME NOT NULL
);

CREATE INDEX idx_mfe_date_scope ON market_focus_events(event_date, scope);
```

---

### 2.5 新增表：`market_focus_stocks`

存储「周聚焦 — 焦点个股」区的数据，每日刷新。

```sql
CREATE TABLE market_focus_stocks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_date      DATE    NOT NULL,
  scope           TEXT    NOT NULL DEFAULT 'week',   -- 'week' | 'month'

  stock_code      TEXT    NOT NULL,
  stock_name      TEXT,
  concept_tags    TEXT,              -- JSON: ["固态电池", "新能源"]
  boards          INTEGER,           -- 连板数，0=非连板
  reason          TEXT,              -- "为什么热" 文案

  -- 量化指标
  chg_pct         REAL,              -- 当日涨跌幅
  turnover_rate   REAL,              -- 换手率
  main_inflow     REAL,              -- 主力净流入（亿元）

  -- 机构/龙虎榜标记
  dragon_tiger    INTEGER DEFAULT 0, -- 1=上榜龙虎榜
  inst_buy        INTEGER DEFAULT 0, -- 1=机构席位买入

  UNIQUE(trade_date, scope, stock_code)
);
```

---

### 2.6 新增表：`market_focus_sectors`

存储「周聚焦 — 热点板块」区的数据，每日刷新。

```sql
CREATE TABLE market_focus_sectors (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_date      DATE    NOT NULL,
  scope           TEXT    NOT NULL DEFAULT 'week',

  sector_name     TEXT    NOT NULL,
  chg_pct         REAL,              -- 今日涨幅
  main_inflow     REAL,              -- 主力净流入（亿元）
  leader_code     TEXT,              -- 领涨股代码
  leader_name     TEXT,

  -- 近5日涨停梯队（JSON array，从旧到新）
  limit_up_trend  TEXT,              -- JSON: [1,3,5,7,7]
  lifecycle_stage TEXT,              -- 'new'|'hot'|'fading'|'dead'
  lifecycle_day   INTEGER,           -- 生命周期第几天

  UNIQUE(trade_date, scope, sector_name)
);
```

---

### 2.7 新增表：`market_tomorrow_focus`

存储「明日重点聚焦」区数据，每日收盘后写入一条，预测次日。

```sql
CREATE TABLE market_tomorrow_focus (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  for_date        DATE    NOT NULL UNIQUE,   -- 针对的交易日（明日）

  -- 关键事件（JSON）
  key_events      TEXT,
  -- [{
  --   "time": "盘前",
  --   "code": "300424",
  --   "title": "XX 中试产线进度公告",
  --   "impact": "high",
  --   "sentiment": "positive"
  -- }]

  -- 关注板块（JSON）
  sector_watch    TEXT,
  -- [{
  --   "name": "固态电池",
  --   "status": "continue",     // "continue"|"fade_risk"|"cold_probe"
  --   "reason": "今日首发，看明日首板→二板晋级"
  -- }]

  -- 关注个股（JSON）
  stock_watch     TEXT,
  -- [{
  --   "code": "300424",
  --   "name": "XX能源",
  --   "concept": "固态电池",
  --   "watch_type": "upgrade",  // "upgrade"|"break_risk"
  --   "label": "晋级候选：2板→3板",
  --   "reason": "今日一字板强势，明日看是否放量晋级"
  -- }]

  -- AI 前瞻
  ai_preview      TEXT,              -- 一句话 AI 前瞻文本

  generated_at    DATETIME NOT NULL
);
```

---

### 2.8 大盘情绪页 API 读写路径

| UI 区域 | 操作 | 涉及表 / 接口 |
|---|---|---|
| 情绪演化 — 近 N 日温度折线 | 读历史 | `market_daily_snapshot` |
| 情绪演化 — 今日数据面板 | 读最新 | `market_daily_snapshot`（is_complete=1） |
| 情绪演化 — 实时行情条（开盘中） | 实时拉取 | `data_provider/` 接口（不落库） |
| 涨停梯队演化 — 近5日轨迹 | 读历史 | `market_limit_ladder_snapshot` |
| 涨停梯队演化 — 今日详情 | 读最新 | `market_limit_ladder_snapshot` + `data_provider/get_limit_up_pool` |
| 周聚焦 — 热点事件 | 读 | `market_focus_events` WHERE scope='week' |
| 周聚焦 — 焦点个股 | 读 | `market_focus_stocks` WHERE scope='week' |
| 周聚焦 — 热点板块 | 读 | `market_focus_sectors` WHERE scope='week' |
| 月聚焦 — 主线题材 / 月度龙头 | 读 | `market_focus_events` + `market_focus_sectors` WHERE scope='month' |
| 明日重点聚焦 | 读 | `market_tomorrow_focus` WHERE for_date=明日 |
| 每日采集（15:30 定时任务） | 写 | 全部大盘情绪相关表 |

---

## 三、索引与约束汇总

```sql
-- market_daily_snapshot
CREATE UNIQUE INDEX uix_mds_date   ON market_daily_snapshot(trade_date);

-- market_limit_ladder_snapshot
CREATE UNIQUE INDEX uix_mlls_date  ON market_limit_ladder_snapshot(trade_date);

-- market_focus_events
CREATE INDEX idx_mfe_scope_date    ON market_focus_events(scope, event_date DESC);

-- market_focus_stocks
CREATE UNIQUE INDEX uix_mfs_date_scope_code ON market_focus_stocks(trade_date, scope, stock_code);

-- market_focus_sectors
CREATE UNIQUE INDEX uix_mfsec_date_scope_name ON market_focus_sectors(trade_date, scope, sector_name);

-- market_tomorrow_focus
CREATE UNIQUE INDEX uix_mtf_for_date ON market_tomorrow_focus(for_date);

-- counterfactual_analysis
CREATE UNIQUE INDEX uix_cf_exp_scenario ON counterfactual_analysis(expectation_id, scenario);

-- expectation_market_context
CREATE UNIQUE INDEX uix_emc_exp_id ON expectation_market_context(expectation_id);
```

---

## 四、采集 / 写入时序

```
每个交易日
  ├── 09:25 盘前
  │     └── market_tomorrow_focus 写入（前一日收盘后生成，today+1 行）
  │
  ├── 15:00 盘中（可选，做盘中快照）
  │     └── market_daily_snapshot (is_complete=0) 写入或更新
  │
  └── 15:30 收盘后完整快照
        ├── market_daily_snapshot (is_complete=1) 写入或更新
        ├── market_limit_ladder_snapshot 写入
        ├── market_focus_stocks (scope='week') 刷新当日数据
        ├── market_focus_sectors (scope='week') 刷新当日数据
        ├── market_focus_events (scope='week') 追加新事件
        ├── [周末] market_focus_events / stocks / sectors (scope='month') 月度汇总
        └── expectation_outcomes 自动评分（如有当日预期记录）
```

---

## 五、与现有存储的差异点

| 对比项 | 现有 | 新增设计 |
|---|---|---|
| 大盘情绪时序 | 无 | `market_daily_snapshot`（唯一时序底表） |
| 涨停梯队历史 | 无 | `market_limit_ladder_snapshot` |
| 市场聚焦内容 | 无 | `market_focus_events / stocks / sectors` |
| 明日重点 | 无 | `market_tomorrow_focus` |
| 预期 — 原则库 | 无 | `user_trading_principles`（原则文本） |
| 预期 — 反事实分析 | 无 | `counterfactual_analysis` |
| 预期 — 录入时市场快照 | 无 | `expectation_market_context` |
| 个股预期 | JSON 内嵌 `user_expectations.stock_expectations` | 保持 JSON（§1.3 补充字段定义） |
| 原则违规 | JSON 内嵌个股预期 | 保持内嵌（`principle_violations` 字段在 stock JSON 中） |
