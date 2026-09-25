# 存储方式审计

> 生成日期：2026-09-21
> 结论：当前存储共 4 种，全部在项目根目录下，以 SQLite 为主。无 Redis / PostgreSQL / MySQL / MongoDB / 向量库 / DuckDB / Parquet / pickle 持久化。

---

## 一、SQLite 关系库（主存储）

- **位置**：`data/stock_analysis.db`（+ `-wal` / `-shm`，WAL 模式已开）
- **配置**：`.env` 的 `DATABASE_PATH=./data/stock_analysis.db`
- **技术**：SQLAlchemy ORM，`src/storage.py` 中 `DatabaseManager`（单例）统一管理，`get_db_url()` 目前**硬编码返回 `sqlite:///...`**（代码有非 sqlite 分支，但未开放 postgres/mysql）

约 40 张表（ORM 模型），按域划分：

| 域 | 表 |
|---|---|
| 行情 | `stock_daily`（日线） |
| 情报资讯 | `news_intel` / `intelligence_sources` / `intelligence_items` |
| 基本面 | `fundamental_snapshot` |
| 选股 | `screening_runs` |
| 分析 / 回测 | `analysis_history` / `backtest_results` / `backtest_summaries` |
| 组合 | `portfolio_accounts` / `portfolio_trades` / `portfolio_cash_ledger` / `portfolio_corporate_actions` / `portfolio_positions` / `portfolio_position_lots` / `portfolio_daily_snapshots` / `portfolio_fx_rates` |
| 对话 / Agent | `conversation_messages` / `conversation_session_states` / `conversation_summaries` / `agent_provider_turns` / `llm_usage` |
| 告警 | `alert_rules` / `alert_triggers` / `alert_notifications` / `alert_cooldowns` |
| 决策信号 | `decision_signals` / `decision_signal_outcomes` / `decision_signal_feedback` |
| 技能观点 | `skill_opinion_samples` / `skill_opinion_outcomes` |
| 预期 | `user_expectations` / `expectation_outcomes` / `expectation_agent_evals` |
| 迁移 | `schema_migrations` |

仓储封装：`src/repositories/` 下的 `*_repo.py`（`stock_repo` / `portfolio_repo` / `expectation_repo` / `intelligence_repo` / `alert_repo` / `backtest_repo` / `analysis_repo` 等）。

---

## 二、文件缓存（JSON）

- `data/cache/akshare_name_map.json`（约 141KB，AkShare 股票名称映射缓存）
- 选股缓存目录（`.env` 注释默认值，按需创建）：
  - `data/screening/snapshot.last_good.json`
  - `data/screening/daily_history/`
  - `data/screening/industry_provider_cache/`

---

## 三、日志文件

- `logs/`：`stock_analysis_YYYYMMDD.log` + `stock_analysis_debug_YYYYMMDD.log`（按天滚动）

---

## 四、进程内内存（非持久化）

- 各 fetcher 的**熔断器 / 限流器**（`realtime_types.py` 的 `CircuitBreaker`、akshare 的 `_enforce_rate_limit`）
- **LLM prompt cache**（provider 隐式缓存 / telemetry，配置 `LLM_PROMPT_CACHE_*`）

---

## 五、与设计稿的差距

设计稿（`ui-design.md` 6.7）提到的「15:30 每日快照存档（JSON）累积情绪时间序列」**目前并不存在** —— 现在唯一的 JSON 是 `akshare_name_map.json`。

大盘情绪的以下时序数据尚未落库，需要新增：

- 量能轨迹（两市成交额近 N 日）
- 双维度情绪温度（短线 / 趋势）
- 涨停梯队历史（涨停池 / 炸板池 / 跌停池 / 昨日涨停表现）
- 外盘情绪温度（美股 / 韩股）

要让 redesign 的「情绪演化近 N 日轨迹」能查历史，必须先补这一层快照存储：要么 SQLite 加表，要么 `data/` 下加 JSON 快照目录。
