# auto-review 设计 — 外盘背离 + 动态过程自动文案

> 版本: v0.2 | 日期: 2026-09-25 | 状态: 草稿待评审（v0.2：外盘采集已落地；LLM 生成改走通用短文案接口）
> 关联: `../storage-design.md`（快照表）、`../api-call-chain.md`（链路）、`../../../design/ui-mockup.html`（§情绪演化）

---

## 一、回答核心问题：这两段话是谁写的

**都不是人工写的，也不是纯模板**。设计为"规则 + LLM"两级生产，收盘采集时一次生成、落库、页面读库：

```
15:30 采集尾部
  ├── 规则引擎（确定性，无 LLM）
  │     ├─ 外盘温度：美股/韩股涨跌 + VIX → 0~100 温度 + 近5日轨迹 → 背离判定
  │     ├─ 周期阶段：温度轨迹 + 梯队断板 + 炸板率 → 冰点/启动/高潮/退潮标签
  │     └─ 维度背离：|短线-趋势| ≥ 15° → 连续天数
  │         ↓ 规则输出 = 结构化"事实清单"（要不要说、说什么数字）
  ├── LLM（经通用短文案接口 generic-comment-api.md，底层 LLMToolAdapter，一次调用）
  │     └─ 场景 sentiment.review：输入事实清单 → 输出三段解读文案（JSON）；失败 → 规则模板降级
  │         ↓
  └── 落库 market_daily_review（页面只读库，永不实时调 LLM）
```

职责边界：

| 内容 | 规则引擎 | LLM |
|---|---|---|
| 背离/阶段**是否触发** | ✅ 判定 | ❌ 不允许改判 |
| 引用哪些**数字** | ✅ 事实清单给定 | ❌ 禁止编造（prompt 约束只准引用给定数字） |
| 文案**措辞/因果叙事** | ❌ | ✅ |
| LLM 不可用时 | ✅ 模板文案兜底（`source='rule'`，前端样式区分） | — |

这样保证：数字永远来自快照表可回放，LLM 只承担自然语言组织，幻觉风险被 prompt 约束 + `source` 标记兜底。

---

## 二、输入数据盘点

### 2.1 外盘情绪卡（先行锚）

| 数据 | mockup 示例 | 来源 | 现状 |
|---|---|---|---|
| 美股隔夜：纳指/标普/道指/SOX/金龙/VIX | +0.8% / +0.5% / +0.3% / +1.4% / +0.6% / 15.2 | `YfinanceFetcher`（us 区） | ✅ 已采集落库（`_collect_overseas` → 快照 `overseas_summary`；ndx/spx/dji/vix；SOX、金龙未含） |
| 韩股今晨：KOSPI/KOSDAQ/三星/海力士 | -0.3% / -0.6% / -1.2% / -0.9% | yfinance（^KS11、^KQ11；kr 区） | ✅ 已采集落库（kospi/kosdaq；三星/海力士未含） |
| 美股/韩股温度 + 近5日轨迹 | 58° / 41°，55→52→54→55→58 | 规则映射（§三.1），轨迹来自前 4 日 review 表 + 当日 | 新增（SOX/金龙/三星/海力士未采集，公式对应项暂缺） |
| 背离判定 + 解读 | 外盘背离盒 | 规则 + LLM | 新增 |

### 2.2 动态过程（周期叙事）

| 数据 | mockup 示例 | 来源 | 现状 |
|---|---|---|---|
| 近10日双温度轨迹 | 78°→…→32° | `market_daily_snapshot` | ✅ 已有 |
| 量能轨迹 + 放/缩量标签 | 1.41→1.18万亿 缩量 | 同上 | ✅ 已有 |
| 炸板率及轨迹 | 18→25→30→38→41% | 同上（本轮已回填 blown_rate） | ✅ 已有 |
| 空间高度断板 | 3板(断)，近5日 6→4→3→3→3 | `market_limit_ladder_snapshot` | ✅ 已有 |
| 阶段标签轨迹（冰点/启动/高潮/退潮） | 09-15 冰点 → 09-21 退潮 | 规则引擎（§三.2），逐日可回算 | 新增 |
| 晋级率 | 41% ↓ | pool detail 连板数分布环比（今 2 板数 ÷ 昨 1 板数） | 新增（可从 `market_pool_detail_snapshot` 算，M3） |
| 大面数（跌停/大跌家数） | 9家 ↑ | 跌停池 + 跌幅统计，契约待定 | M3，v1 置空 |
| 两融余额 | +18亿 | 数据源未接 | M3，v1 置空 |

---

## 三、规则引擎设计

### 3.1 外盘温度（0~100）

```
us_temp = clamp(50
    + ndx_chg * 6 + spx_chg * 3 + dji_chg * 2      # 主要指数，每 1% ≈ ±2~6 分
    + sox_chg * 4                                   # 半导体：与 A 股科技联动权重
    + kbwb_chg * 2                                  # 金龙指数（中概先行）
    - (vix - 18) * 1.5, 0, 100)                     # VIX 反向，18 为中性

kr_temp = clamp(50
    + kospi_chg * 5 + kosdaq_chg * 4
    + samsung_chg * 2 + hynix_chg * 2, 0, 100)      # 半导体双雄单独加权
```

- 系数为首版标定（对齐 mockup 样例量级），上线后按体感校准，常量集中一处便于调参
- 近5日轨迹 = 前 4 日 review 表温度 + 当日，端点直接返回
- **外盘背离**：`sign(us_temp-50) ≠ sign(kr_temp-50)` 且 `|us_temp - kr_temp| ≥ 15`，同时要求半导体链条贡献方向一致（SOX 与三星/海力士符号相反时备注"链条内部分歧"）

### 3.2 周期阶段标签

对**每个交易日**可确定性回算（历史标签随数据重算，不落死值）：

| 标签 | 规则（满足任一） |
|---|---|
| 高潮 climax | 短线温度 ≥ 70 且为近10日新高 |
| 退潮 ebb | 较近10日高点回落 ≥ 15°；或（炸板率 ≥ 35% 且 今日 max_height < 昨日，即断板） |
| 冰点 ice | 短线温度 ≤ 30 且 涨停家数为近10日最低 |
| 启动 start | 较近10日低点回升 ≥ 10° 且 首板家数 > 昨日 |
| 震荡 oscillation | 其余 |

判定优先级：冰点 > 退潮 > 高潮 > 启动 > 震荡；标签序列写入 `stage_tags` JSON，前端 phase-tags 直接渲染。

### 3.3 维度背离

现有前端阈值（`|st - trend| ≥ 15`）后移到采集侧：触发时回查快照表算**连续天数**（mockup"已持续 2 日"），LLM 文案里要求给出天数与两侧阶段标签。

---

## 四、LLM 生成设计

### 4.1 调用方式

- **走通用短文案接口**（[generic-comment-api.md](generic-comment-api.md)）：本功能注册为场景 `sentiment.review`，超时/重试/解析校验/模板降级/`source` 标记/幂等落库由通用接口统一承担，本文只定义该场景的 prompt、事实清单与落库字段
- 底层仍为 `src/agent/llm_adapter.py LLMToolAdapter.call_text()`（channel/模型走现有配置，不新增配置项；`is_available` 为 False 时通用接口直接走 `degrade_template`）
- **每日采集尾部一次调用**，输出三段，避免多次请求；生成结果落库后不重复生成；次日盘前对"前日失败"补采（与明日重点同策略）

### 4.2 Prompt 草案

```
你是 A 股市场情绪复盘助手。根据给定事实清单输出当日解读，严格 JSON：
{
  "overseas_diverge": "外盘解读（≤60字；无背离则一句话概括外部锚方向）",
  "process": "动态过程（≤80字；周期叙事：从哪个标签走到哪个标签，必须引用给出的温度/高度/炸板率数字）",
  "dimension_diverge": "短线×趋势背离解读（≤60字；无背离输出空字符串）"
}
约束：
1. 只允许引用事实清单中出现的数字与日期，禁止推算新数字；
2. 只做状态判断（周期位置、强弱、背离），不给任何买卖建议；
3. 叙事口径示例：{few_shot: 上文 mockup 两段文案}。
事实清单（由规则引擎序列化）：
{stage_tags, st_traj, trend_traj, amount_traj, blown_rate_traj, max_height_traj,
 us_detail, kr_detail, us_temp, kr_temp, overseas_diverge_flag,
 dim_diverge_flag, dim_diverge_days}
```

mockup 两段文案作为 few-shot 放入 prompt（文案口径的"标准答案"就是它），保证风格一致。本节 prompt 即通用接口场景 `sentiment.review` 的 `prompt_template` 注册内容（见 generic-comment-api.md §三）。

### 4.3 规则模板降级（source='rule'）

复用现有 `generate_tomorrow_focus` 的 ai_preview 拼装思路扩展为三段模板，例：

> 动态过程：短线情绪 {today_st}°（{stage}，较昨日 {delta}°），涨停 {limit_up} 家、炸板率 {blown_rate}%、最高 {max_height} 板；趋势情绪 {trend}°（{trend_stage}）。

模板文案信息量低但数字准确，前端按 `source` 显示"规则生成"角标，与"AI 生成"区分。该模板函数即场景注册的 `degrade_template`。

---

## 五、存储设计

新表 `market_daily_review`（每日一条，**唯一真源**；不 ALTER 现有快照表，`overseas_summary` 字段继续置空、由本表接管外盘语义）：

```sql
CREATE TABLE market_daily_review (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_date      DATE    NOT NULL UNIQUE,

  -- 外盘（行情数值 + 温度 + 轨迹）
  us_detail       TEXT,              -- JSON: {"ndx":0.8,"spx":0.5,"dji":0.3,"sox":1.4,"kbwb":0.6,"vix":15.2}
  kr_detail       TEXT,              -- JSON: {"kospi":-0.3,"kosdaq":-0.6,"samsung":-1.2,"hynix":-0.9}
  us_temp         REAL,              -- 0~100
  kr_temp         REAL,
  us_traj         TEXT,              -- JSON: [55,52,54,55,58]
  kr_traj         TEXT,
  overseas_stage  TEXT,              -- 'diverge' | 'align_up' | 'align_down' | 'neutral'
  overseas_text   TEXT,              -- LLM/模板 解读

  -- 动态过程
  stage_tag       TEXT,              -- 当日标签 'ice'|'start'|'climax'|'ebb'|'oscillation'
  stage_tags      TEXT,              -- JSON 近10日: [{"date":"09-15","tag":"ice"},...]
  process_text    TEXT,              -- LLM/模板 动态过程文案

  -- 维度背离
  dim_diverge_days INTEGER,          -- 连续背离天数，0/NULL=无
  dim_diverge_text TEXT,

  -- 生成元数据
  source          TEXT NOT NULL DEFAULT 'rule',  -- 'llm' | 'rule'
  model           TEXT,              -- 生成模型标识（source='llm' 时）
  generated_at    DATETIME,

  CHECK (source IN ('llm', 'rule'))
);
```

---

## 六、API 与前端

### 6.1 API

`GET /market-sentiment/overview` 组装（**读库，无 LLM 调用**）：

- `overseas`（现有字段，当前恒 null）：改为 review 表结构 → `{us: {detail, temp, traj}, kr: {...}, stage, text, source}`
- 新增 `review`：`{stage_tag, stage_tags, process_text, dim_diverge_days, dim_diverge_text, source}`

当日未生成（盘中）→ 字段 null + 前端空态（现有"外盘摘要待收盘采集后更新"）。不加新端点，避免页面多一次请求。

### 6.2 前端（apps/dsa-web）

| 区块 | 改动 |
|---|---|
| OverseasCard | 基础版已落地（读 `overview.overseas` 扁平字段：标普/纳指/道指/VIX + KOSPI/KOSDAQ chips）；待 review 表落地后补：温度、近5日轨迹、背离盒（`overseas_text`，按 `overseas_stage` 显隐） |
| MainAxis context-box | "动态过程"文案从规则拼接改为 `review.process_text`；`source` 角标区分"AI 生成/规则生成" |
| DualDimension 背离提示 | 文案接 `dim_diverge_text`，标签显示持续天数 |
| 情绪卡 💡 tip | 新增 `sentiment.tip_short` / `sentiment.tip_trend` 文案位（读通用接口落库结果，见 generic-comment-api.md §七） |

---

## 七、采集链路与分期

```
collect_daily_snapshot()（现有）
  ├─ 头部 _collect_overseas()：外盘行情已采集 → 快照 overseas_summary（已落地）
  └─ 尾部新增 generate_daily_review()：
       1. 规则引擎：读快照表（含 overseas_summary）+ review 表（轨迹）
       2. 通用接口 generate('sentiment.review')（LLM 可用时）→ 三段文案；失败 → 模板
       3. upsert market_daily_review
```

| 期 | 内容 | 依赖 |
|---|---|---|
| M1 规则版 | ~~外盘采集~~（✅ 已落地）+ 温度+轨迹、阶段标签、维度背离天数、模板文案落库；前端接 `review` | 无 LLM，可独立上线 |
| M2 LLM | 通用短文案接口 runner + `sentiment.review` 场景接入（source 标记、次日盘前补采） | generic-comment-api runner + LiteLLM 网关可用 |
| M3 指标补全 | 晋级率（pool detail 环比）、大面数、两融；外盘 few-shot 校准 | 池明细表（已就绪）、两融数据源 |

## 八、开放问题

1. 韩股盘中时点：15:30 采集时首尔已收盘（时差 +1h），"韩股今晨"实为当日收盘，文案口径需统一为"韩股（今日）"，mockup 措辞待修
2. 金龙指数代理标的（CIBR/KWEB/中概 ETF）选哪个，M1 定（当前 `_collect_overseas` 未含金龙/SOX，温度公式对应项暂缺）
3. 温度系数与阶段阈值的首周回测校准（用 `market_daily_snapshot` 历史数据回算 stage_tags 对比体感）
4. LLM 输出 JSON 解析兜底：`call_text` 已支持 max_tokens/timeout，未透传 response_format；先用严格 JSON prompt + 解析重试，收敛至 generic-comment-api.md §九.2 跟踪
