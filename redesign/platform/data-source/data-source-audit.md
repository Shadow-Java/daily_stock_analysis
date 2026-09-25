# 数据源审计 —— 大盘情绪页需求 vs 现有数据层

> 生成日期：2026-09-21
> 结论：原 `feture-ui/server` 占位目录已随重构移除。真正的数据层在项目根 `data_provider/`，且已有 `DataFetcherManager` 统一门面（fan-out 到多个数据源）。
> 设计稿位置：`redesign/features/market-sentiment/ui-design.md`（v0.4）

---

## 一、现有数据源清单（`data_provider/`）

| Fetcher | 底层数据源 | 覆盖市场 | 主要用途 |
|---|---|---|---|
| `akshare_fetcher.py` | AkShare（东财/新浪） | A股 | 涨停池、市场统计、板块/概念、热股、指数 |
| `tushare_fetcher.py` | Tushare | A股 | 历史行情（需 token） |
| `efinance_fetcher.py` | efinance | A股 | 行情、市场统计 |
| `baostock_fetcher.py` | BaoStock | A股 | 历史行情 |
| `pytdx_fetcher.py` | PyTDX | A股 | 历史行情 |
| `tencent_fetcher.py` | 腾讯行情 | A股/港股 | 行情 |
| `yfinance_fetcher.py` | Yahoo Finance | 美/港/日/韩/台 | 指数 + 个股 |
| `alphavantage_fetcher.py` | AlphaVantage | 美股 | 备用（需 key） |
| `finnhub_fetcher.py` | Finnhub | 美股 | 备用（需 key） |
| `futu_fetcher.py` | 富途 OpenD | 美/港 | 券商行情（需 OpenD） |
| `longbridge_fetcher.py` | 长桥 | 美/港 | 券商行情（需账号） |
| `tickflow_fetcher.py` | tickflow | — | 备用 |
| `tw_institutional_fetcher.py` | 台股机构 | 台股 | 机构数据 |

统一入口：`data_provider/base.py` 的 `DataFetcherManager`，对各 fetcher 做 fan-out + 降级。

---

## 二、设计稿需求 → 支持情况

| 设计稿要求 | 现状 | 结论 |
|---|---|---|
| **涨停池** | `get_limit_up_pool()` → `ak.stock_zt_pool_em`，返回 代码/名称/涨跌幅/最新价/成交额/换手率/封板资金/首次封板时间/最后封板时间/炸板次数/涨停统计/连板数/所属行业 | ✅ 完整支持，字段超预期 |
| **首封时间筛选** | `first_limit_time` + `_normalize_limit_time_value()` 已标准化为 HHMMSS | ✅ 直接可做分桶 |
| **板块分类** | `get_sector_rankings()` / `get_concept_rankings()` + 涨停池自带 `所属行业` | ✅ 可聚合，需 join |
| **炸板池** | 仅涨停池内有 `炸板次数` 字段，无独立炸板池（AkShare 有 `stock_zt_pool_zbgc_em`） | ❌ 需新增 |
| **跌停池** | 仅 `get_market_stats` 算出 `limit_down_count` 家数，无个股列表（AkShare 有 `stock_zt_pool_dtgc_em`） | ❌ 需新增 |
| **昨日涨停表现** | 无（AkShare 有 `stock_zt_pool_previous_em` / 昨日涨停股池） | ❌ 需新增 |
| **涨跌家数 / 成交额** | `get_market_stats()` → 东财/新浪，输出 up/down/flat/limit_up/limit_down/total_amount | ✅ 支持 |
| **量能轨迹（近10日）** | 只有当日 total_amount；历史序列需 15:30 快照累积，或用 `_fetch_index_data()` 指数历史成交额 | ⚠️ 需补历史序列 |
| **两融余额** | 无（AkShare 有 `stock_margin_sse` / `stock_margin_szse`） | ❌ 需新增 |
| **主力净流入** | 个股/板块有（`fundamental_adapter` 主力净流入、板块资金流排行），大盘近5日趋势未聚合 | ⚠️ 部分支持 |
| **新高 / 新低** | 无现成接口，需从 OHLCV 历史计算 60 日新高 | ❌ 需计算 |
| **龙虎榜** | `get_dragon_tiger_context()` → `ak.stock_lhb_stock_statistic_em` / `stock_lhb_detail_em` / `stock_lhb_jgmmtj_em`（个股是否上榜 + 近20日次数） | ✅ 个股维度支持 |
| **焦点个股榜** | `get_hot_stocks()`（东财/雪球热股）+ 龙虎榜 flag；成交额/换手率榜可从全市场 spot 排序 | ⚠️ 需组合排序 |
| **美股 道指/纳指/标普/VIX** | `yfinance_fetcher._get_us_main_indices()` + `us_index_mapping.py`（SPX/IXIC/DJI/NDX/VIX） | ✅ 支持 |
| **美股 SOX / 金龙** | `us_index_mapping.py` 无费城半导体(^SOX)、纳斯达克中国金龙 | ❌ 需加映射（改1处即可） |
| **韩股 KOSPI/KOSDAQ** | `yfinance_fetcher._get_kr_main_indices()`（^KS11 / ^KQ11） | ✅ 支持 |
| **韩股 三星/海力士** | 走 yfinance 个股路径（`005930.KS` / `000660.KS`，base.py 已识别 KR 后缀） | ⚠️ 支持，需加个股代码 |
| **龙头/小弟识别** | 非数据源能力，是规则推导（连板数/封板时间/炸板/行业），数据字段已够 | ⚠️ 需写规则 |

---

## 三、需要补齐的缺口

集中在 AkShare 已有的免费接口，改动不大：

1. **炸板池 / 跌停池 / 昨日涨停表现** —— 三个 `ak.stock_zt_pool_*_em` 接口还没接。
2. **两融余额** —— `stock_margin_sse` / `stock_margin_szse` 未接。
3. **美股 SOX / 金龙** —— 只在 `us_index_mapping.py` 加两条映射。
4. **量能 / 新高新低的历史轨迹** —— 需要 15:30 快照累积（设计稿 6.7 已写），或从指数历史成交额推导。

---

## 四、AI Agent 是否能直接调用这些接口？

**不能。** 现有 AI Agent（`src/agent/`）的工具面（tool surface）只暴露了一部分数据接口，且**没有** `get_limit_up_pool` / `get_market_stats` / `get_concept_rankings` / `get_hot_stocks` / `get_dragon_tiger_context`。

Agent 实际暴露的工具清单（`src/agent/tools/`）：

| 文件 | 工具名 | 对应底层接口 |
|---|---|---|
| `data_tools.py` | `get_realtime_quote` | 实时行情 |
| `data_tools.py` | `get_daily_history` | 日线历史 |
| `data_tools.py` | `get_chip_distribution` | 筹码分布 |
| `data_tools.py` | `get_analysis_context` | 分析上下文 |
| `data_tools.py` | `get_stock_info` | 个股信息 |
| `data_tools.py` | `get_portfolio_snapshot` | 组合快照 |
| `data_tools.py` | `get_capital_flow` | 资金流 |
| `market_tools.py` | `get_market_indices` | `get_main_indices` |
| `market_tools.py` | `get_sector_rankings` | `get_sector_rankings` |
| `search_tools.py` | `search_stock_news` | 新闻搜索 |
| `search_tools.py` | `search_comprehensive_intel` | 综合情报 |
| `analysis_tools.py` | `analyze_trend` / `calculate_ma` / `get_volume_analysis` / `analyze_pattern` | 技术分析 |
| `backtest_tools.py` | `get_skill/strategy/stock_backtest_summary` | 回测汇总 |

### 关键结论

- `get_limit_up_pool`（涨停池）、`get_market_stats`（涨跌家数/成交额）、`get_concept_rankings`（概念）、`get_hot_stocks`（热股）、`get_dragon_tiger_context`（龙虎榜）**在 `DataFetcherManager` 上都已实现**，但目前**只在 pipeline / market_analyzer 内部使用，没有包装成 agent tool**。
- Agent 要调用它们，需要仿照 `market_tools.py` 的写法，逐个包装成 `ToolDefinition`（含 `_handle_*` + 参数 schema + policy）并注册进 `ToolRegistry`。
- 大盘情绪页（redesign）如果希望由 agent 提供数据，需要新增一组「市场情绪类」工具：`get_limit_up_pool` / `get_market_stats` / `get_concept_rankings` / `get_hot_stocks` / `get_dragon_tiger_context`，以及补齐炸板池/跌停池/昨日涨停/两融/外盘 SOX·金龙等缺口后再封装。
