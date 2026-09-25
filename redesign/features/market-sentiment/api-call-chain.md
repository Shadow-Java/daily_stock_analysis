# UI → 前后端调用链路设计 — 大盘情绪页

> 版本: v0.1 | 日期: 2026-09-25 | 状态: 待评审
> 关联: `roadmap.md`（阶段目标）、`storage-design.md`（表设计）、`../../platform/agent/tool-decision-and-call-chain.md`（Agent 链路参考）

---

## 一、总链路图

```
┌─ 前端 apps/dsa-web ──────────────────────────────────────────────────┐
│ SentimentPage.tsx                                                    │
│   ├─ 进入页面 → 并行拉取 5 个区块数据                                  │
│   ├─ tab 切换（明日重点/周聚焦/月聚焦）→ 按需请求 focus/tomorrow       │
│   └─ 盘中 → 30s 轮询 /overview 刷新实时条                             │
│         ↓                                                            │
│ src/api/sentiment.ts （新增，仿 agent.ts 风格封装）                    │
│   fetch('/api/v1/market-sentiment/...')                              │
│   （开发期 Vite proxy: /api → 127.0.0.1:8000，生产同源托管）           │
└──────────────────────────────────────────────────────────────────────┘
   ↓ HTTP GET (JSON)
┌─ 后端 FastAPI ───────────────────────────────────────────────────────┐
│ api/v1/endpoints/market_sentiment.py （新增）                         │
│   挂载于 api/v1/router.py，prefix="/market-sentiment"                │
│         ↓                                                            │
│ src/services/market_sentiment_service.py （新增，查询聚合层）          │
│   ├─ 读库：src/repositories/（快照表 → storage.py 模型）               │
│   └─ 实时/降级：data_provider.DataFetcherManager（唯一取数出口）        │
└──────────────────────────────────────────────────────────────────────┘
```

设计原则：

1. **前端只认 `/api/v1/market-sentiment/*` 一个命名空间**，不直连 data_provider 概念
2. **历史读快照表，实时读 data_provider**：盘中实时条不走库；15:30 采集后一切以快照表为准，保证历史轨迹稳定可回放
3. **区块级降级**：任一数据缺失，对应区块返回空对象 + `degraded` 标记，不拖垮整个响应（遵循仓库"单一数据源失败不拖垮主流程"护栏）

---

## 二、API 契约设计

### 2.1 端点清单

| # | 端点 | 方法 | 用途（对应 mockup 区块） | 数据来源 |
|---|---|---|---|---|
| 1 | `/overview` | GET | 情绪演化—今日面板 + 实时行情条 + 指数条 | 快照表（收盘后）/ data_provider 实时（盘中，`realtime=true` 参数控制） |
| 2 | `/trend` | GET `?days=N&metrics=temperature,amount,advancer` | 情绪演化—近 N 日折线（双温度/成交额/涨跌家数） | `market_daily_snapshot` |
| 3 | `/limit-ladder` | GET `?days=5` | 涨停梯队演化—近 5 日轨迹 | `market_limit_ladder_snapshot` |
| 4 | `/limit-ladder/today` | GET `?pool_type=limit_up\|limit_down\|blown` | 今日池详情（涨停/跌停/炸板池明细） | `market_pool_detail_snapshot`（当日快照优先）；盘中/缺当日数据时实时拉 `data_provider` 兜底，实时为空回退该池最近交易日（响应 `pool_source` 标记来源） |
| 5 | `/focus` | GET `?scope=week\|month` | 市场聚焦（事件/个股/板块三合一） | `market_focus_events/stocks/sectors` |
| 6 | `/tomorrow` | GET | 明日重点（默认 tab：事件/板块/个股/AI 前瞻） | `market_tomorrow_focus` |

### 2.2 响应结构约定

与现有 `/expectations` 等 API 一致，**返回裸 Pydantic 模型**（无 `{code,data}` 包裹），错误走 HTTP 状态码 + `ErrorResponse`；缺失字段用 `null`，`degraded` 列表标记降级项。核心字段示例（已实现）：

```jsonc
// GET /api/v1/market-sentiment/overview
{
  "trade_date": "2026-09-25",
  "is_complete": true,          // false = 盘中或未采集，前端显示"盘中"态
  "temperature": { "st": 72, "trend": 55 },   // 双温度
  "amount": { "total": 14200, "sh": null, "sz": null, "vs_prev_pct": 8.3 },
  "advance_decline": { "up": 3200, "down": 1800, "flat": 120, "limit_up": 68, "limit_down": 5, "blown_rate": null },
  "inflow": { "main": null, "north": null },   // null = 当日该源不可用
  "indices": { "hs300_close": 4000.2, "hs300_chg_pct": 0.82, "sh50_chg_pct": 0.5, "chinext_chg_pct": 1.15 },
  "new_high_60d": null, "new_low_60d": null,
  "overseas": null,             // v1 未采集
  "realtime": null,             // 仅 realtime=true 时附实时数据
  "degraded": ["market_stats"]  // 降级字段列表，前端据此显示"—"
}

// GET /api/v1/market-sentiment/focus?scope=week
{
  "scope": "week",
  "events":  [ { "event_date": "...", "title": "...", "impact_label": "..." } ],
  "stocks":  [ { "stock_code": "300424", "stock_name": "...", "boards": 3, "reason": "..." } ],
  "sectors": [ { "sector_name": "固态电池", "chg_pct": 5.2, "lifecycle_stage": "hot",
                 "limit_up_trend": null } ],
  "degraded": []
}
```

### 2.3 前端封装（`src/api/sentiment.ts`）

```ts
export const sentimentApi = {
  getOverview: (realtime = false) =>
    fetch(`/api/v1/market-sentiment/overview${realtime ? '?realtime=true' : ''}`).then(toJson),
  getTrend:    (days = 30) => ...,
  getLadder:   (days = 5)  => ...,
  getLadderToday: () => ...,
  getFocus:    (scope: 'week' | 'month') => ...,
  getTomorrow: () => ...,
};
```

页面加载策略：`Promise.allSettled` 并行拉 5 个端点，单个失败仅置该区块空态；tab 切换不重复请求（scope 结果本地缓存）。

---

## 三、采集任务链路（写路径）

```
调度触发（现有三选一，按部署形态）
  main.py --schedule（本地/服务器 cron 式）
  GitHub Actions 每日任务
  docker-compose analyzer 服务
        ↓
15:30（收盘后数据稳定）→ src/services/market_sentiment_service.py collect()
        ↓
data_provider.DataFetcherManager（唯一取数出口，源内自动 fallback）
  ├─ get_limit_up_pool()        涨停池/连板梯队 → 聚合首板~5板家数、炸板率、板块分布
  ├─ get_limit_down_pool()      跌停池（akshare stock_zt_pool_dtgc_em）
  ├─ get_blown_pool()           炸板池（akshare stock_zt_pool_zbgc_em）→ 计算炸板率 blown/(limit_up+blown)
  ├─ 指数实时/收盘               hs300/sh50/chinext
  ├─ 市场涨跌统计 + 两市成交额   计算涨跌家数、amount_vs_prev
  └─ 可用则补：主力/北向净流入、60日新高新低、外盘摘要（失败置 null，记 degraded）
        ↓
计算 sentiment_st / sentiment_trend（0~100 双温度，规则版先行，后续可换 LLM/模型）
        ↓
写入快照表（upsert 当日 trade_date 行）：
  market_daily_snapshot (is_complete=1)
  market_limit_ladder_snapshot
  market_pool_detail_snapshot 三类池明细刷新（盘后 /limit-ladder/today 读库不再实时拉源）
  market_focus_stocks/sectors 刷新当日；market_focus_events 追加
        ↓
（Phase 2 挂接）expectation_outcomes 收盘自动评分 —— 同一批次尾部执行
```

明日重点（`market_tomorrow_focus`）生成时机：采集完成后，用当日梯队/聚焦数据走 LiteLLM 网关生成一次（失败则次日盘前重试），写入 `for_date=下一交易日`。

---

## 四、错误处理与降级矩阵

| 场景 | 后端行为 | 前端表现 |
|---|---|---|
| 某数据源当日失败 | Manager 内 fallback 到下一源；全部失败则该字段 null + degraded 列表 | 对应指标显示"—" |
| 快照表无今日数据（未到 15:30） | `/overview` 返回 `is_complete=false`，`realtime=true` 时附实时数据 | 面板标"盘中"；折线图到昨日为止 |
| 新库无任何历史 | `/trend` 返回空数组 | 折线区空态引导"数据采集中" |
| `/tomorrow` 未生成 | 返回 404 语义（data=null） | 明日重点 tab 显示"待生成，预计收盘后更新" |
| 采集任务本身失败 | 日志 error + 次日重试不补历史（温度曲线允许断点） | 折线断点连续绘制 |

---

## 五、Phase 2 增量（预期管理页链路）

复用同一模式，差异点：

- 后端**已存在** `api/v1/endpoints/expectations.py` 10 条路由（创建/today/列表/详情/PATCH/DELETE/score/outcome/eval），前端新增 `src/api/expectations.ts` 对接即可
- 录入页 Step 2「市场背景自动加载」= 调 `/market-sentiment/overview` + `/tomorrow` 拼装快照，随 `POST /expectations` 一并落 `expectation_market_context`（N3 阶段）
- Agent 点评走 `POST /expectations/{id}/eval`（同步生成）或复用 `/api/v1/agent/chat/stream` 的 SSE 模式（若要做流式点评，参考 `../../platform/agent/tool-decision-and-call-chain.md` 第二节）
