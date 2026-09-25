# 功能目标与路线图 — 大盘情绪页 → 预期管理

> 版本: v0.1 | 日期: 2026-09-25 | 状态: 待评审
> 关联文档: `storage-design.md`（表设计）、`expectation-management.md`（预期管理详设）、`../../platform/storage/storage-migration.md`（迁移机制）

---

## 一、总目标

为 redesign 新前端交付两个高价值页面，形成「**看盘 → 判断 → 复盘**」闭环：

```
Phase 1  大盘情绪页        每天看盘的第一入口：今天市场什么温度、钱在哪、明天看什么
   ↓ （情绪数据是预期录入的市场背景来源）
Phase 2  预期管理页        记录自己的判断 → 收盘自动评分 → 自我复盘 → Agent 点评
```

**为什么先做大盘情绪页：**

1. **数据依赖方向**：预期录入页 Step 2「市场背景自动加载」（新闻/事件/AI 信号/情绪参考）依赖情绪页的采集底表 `market_daily_snapshot`。先有采集，预期页才有数据可快照
2. **采集任务需要时间积累**：情绪温度/涨停梯队/成交额的历史轨迹必须靠每日 15:30 采集任务逐日累积，越早上线越早有曲线可看；预期管理的核心流程（录入/评分/复盘）不依赖历史积累
3. **使用频率**：情绪页是每日多次查看的看盘入口，预期页是每日一次的录入+复盘入口，先满足高频

---

## 二、Phase 1 — 大盘情绪页

### 2.1 目标

按 `redesign/design/ui-mockup.html` 的排版，交付一个大屏情绪页：
明日重点（tab 默认）→ 周聚焦 → 月聚焦；情绪演化区（双温度折线 + 今日面板）；涨停梯队演化区。

### 2.2 里程碑

| 里程碑 | 内容 | 依赖 |
|---|---|---|
| **M1 采集服务** | 新增 `src/services/market_sentiment_service.py`（或 snapshot 采集模块）：15:30 触发，经 `data_provider` 取涨停池/指数/涨跌家数/成交额，计算双温度分，写入快照表；挂接现有调度（`main.py --schedule` / GitHub Actions / Docker analyzer） | 存储落地 |
| **M2 存储落地** | 在 `src/storage.py` 按迁移纪律新增 5 张表（`market_daily_snapshot` / `market_limit_ladder_snapshot` / `market_focus_*` ×3 / `market_tomorrow_focus`）：模型类 + `_ensure_*` 幂等迁移方法 | — |
| **M3 API** | 新增 `api/v1/endpoints/market_sentiment.py`，挂载 `/api/v1/market-sentiment/*`（详见 `api-call-chain.md`） | M2 |
| **M4 前端页面** | `apps/dsa-web` 新增 `SentimentPage.tsx` + `src/api/sentiment.ts`，按 mockup 排版实现 | M3 |

### 2.3 数据能力现状（已核对代码）

| 数据 | 现状 | 缺口 |
|---|---|---|
| 涨停池/连板梯队 | ✅ `data_provider/base.py:438` 契约 `get_limit_up_pool`，akshare 实现（`ak.stock_zt_pool_em`，akshare_fetcher.py:2350），Manager 自动切换源 | 首封时间分布需从池内字段聚合 |
| 热点板块/概念 | ✅ `MarketHotspotService.get_hotspots / get_concept_rankings`（market_hotspot_service.py:42） | 缺生命周期阶段推导（new/hot/fading） |
| 指数行情 | ✅ `data_provider` 实时 + `stock_daily` 历史 | — |
| 涨跌家数/两市成交额聚合 | ❌ 无市场级聚合接口 | 需在 M1 采集时计算落表 |
| 北向/主力净流入、两融 | ⚠️ 部分源有，无统一契约 | M1 按可用源降级采集，字段可空 |
| 明日重点（事件/晋级候选） | ❌ 无 | M1 后期接 LLM 生成（走现有 LiteLLM 网关） |

### 2.4 验收标准

- [ ] 交易日 15:30 后 `market_daily_snapshot`（is_complete=1）与 `market_limit_ladder_snapshot` 各有一条当日记录
- [ ] 情绪页五个 API 均可返回近 N 日数据；单数据源失败不影响其余区块（降级为字段空 + 提示）
- [ ] 前端页面在无历史数据（新库）时优雅降级为空态，不报错

---

## 三、Phase 2 — 预期管理页

### 3.1 目标

按 mockup 的 5 步录入流程（心理快照 → 市场背景 → 大盘预期 → 个股预期 → 综合判断）+ 详情复盘页 + 列表页，接通已有后端，补齐缺口。

### 3.2 现状（已核对代码，比详设草稿乐观）

| 层 | 现状 |
|---|---|
| 存储 | ✅ `user_expectations` / `expectation_outcomes` / `expectation_agent_evals` 三张表已在 `src/storage.py:4357-4488`（含心理快照字段、CheckConstraint） |
| Repository | ✅ `src/repositories/expectation_repo.py` 三个类（Expectation/Outcome/AgentEval Repository） |
| API | ✅ `api/v1/endpoints/expectations.py` 已有 10 条路由：创建/today/列表/详情/PATCH/DELETE/score/outcome/eval(POST+GET) |
| 采集依赖 | ⏳ 待 Phase 1 的 `market_daily_snapshot` 提供市场背景快照来源 |
| 未实现 | ❌ `user_trading_principles` / `counterfactual_analysis` / `expectation_market_context` 三张新表及其 API |
| 前端 | ❌ 页面全部待做 |

### 3.3 里程碑

| 里程碑 | 内容 |
|---|---|
| **N1 前端页面** | 基于现有 10 条 API 先做录入页 + 列表页 + 详情复盘页（不含原则检查/反事实） |
| **N2 收盘评分接通** | 评分触发挂接 Phase 1 的 15:30 采集任务尾部（同一调度批次） |
| **N3 增强能力** | 三张新表（原则库/反事实/市场背景快照）+ 对应 API + UI；Socratic 追问、Agent 周报 |

---

## 四、现有文档契合度审查结论

### 4.1 `storage-design.md` — ✅ 契合，无需大改

- 预期管理三张表的字段描述与 `src/storage.py:4357-4488` 实际定义一致（含 `index_score_detail` 命名、`self_score` 1~5 约束等）
- 新增 8 张表设计遵循现有纪律：INTEGER PK、JSON 存 TEXT、纯加列演进、UNIQUE 约束命名风格与现有一致
- 唯一建议：§2.8 中"`data_provider/get_limit_up_pool`"已验证存在，可在文档中补上代码坐标（base.py:438 / akshare_fetcher.py:2350）

### 4.2 `expectation-management.md` — ⚠️ 需修订三处

| # | 问题 | 修订建议 |
|---|---|---|
| 1 | **状态过时**：文档标注"v0.1 草稿/待评审"，但第七节"新增文件清单"（schemas/repositories/services/endpoints）已基本存在于代码中 | 状态改为"部分已实现"，第七节改为"现状清单 + 待补清单"（补：三张新表、评分调度挂接、市场背景快照来源） |
| 2 | **字段与实际表不一致**：草稿用 `UUID` 主键 + `JSON` 列类型 + 无心理快照；实际为 `INTEGER AUTOINCREMENT` 主键 + `TEXT` 存 JSON + 含 emotion_index 等心理快照字段 | 第三节"数据模型"以 `storage-design.md` §1.2/1.3 为准，草稿保留业务流程与 Agent 设计部分 |
| 3 | **API 与实际路由有出入**：草稿设计 `/expectations/stats` 统计页等；实际已有的是 `{id}/score`、`{id}/outcome` 等 10 条，无 stats 聚合端点 | 统计页 API 列入 Phase 2 N3 待补清单，不在草稿中当作已有能力引用 |

### 4.3 结论

两份文档保留：`storage-design.md` 作为存储唯一真源；`expectation-management.md` 修订后作为预期管理的业务流程/Agent 设计参考，技术契约部分统一指向 `storage-design.md`，避免双真源漂移。

---

## 五、里程碑顺序总览

```
M2 存储（5 张情绪表） ──► M1 采集服务（15:30） ──► M3 API ──► M4 情绪页前端
                                                                │
                                                                ▼
                                          N1 预期页前端（接已有 10 条 API）
                                                │
                                                ▼
                                    N2 收盘评分挂接 ──► N3 增强能力（3 张新表 + 统计 + Agent 周报）
```
