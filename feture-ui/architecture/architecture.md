# 项目架构总结（daily_stock_analysis）

> 日期：2026-09-21
> 目的：梳理主项目各层级职责，作为 `feture-ui`（新前端 / 新 server）开发时的参考地图。

## 〇、整体分层图

```
┌─────────────────────────────────────────────────────────────┐
│  触发层   main.py(定时/CLI) · GitHub Actions · docker        │
├─────────────────────────────────────────────────────────────┤
│  接口层   api/  (FastAPI, /api/v1/*)      bot/  (IM 机器人)  │
├─────────────────────────────────────────────────────────────┤
│  智能层   src/agent/ (自研 Agent Executor)                   │
│           src/llm/   (LiteLLM 多模型网关)                    │
├─────────────────────────────────────────────────────────────┤
│  业务层   src/services/ (分析/预期/信号/持仓/告警/复盘...)    │
│           src/core/    (pipeline/回测引擎/交易日历)           │
│           src/ 根      (analyzer/market_analyzer/guardrail)  │
├─────────────────────────────────────────────────────────────┤
│  数据层   src/repositories/ (SQLAlchemy Repo)                │
│           src/storage.py    (SQLite 表定义)                  │
├─────────────────────────────────────────────────────────────┤
│  数据源   data_provider/ (AkShare/Tushare/Futu/YFinance...)  │
├─────────────────────────────────────────────────────────────┤
│  策略配置 strategies/ (15 个 YAML 策略)                      │
├─────────────────────────────────────────────────────────────┤
│  前端     apps/dsa-web (React+Vite) · apps/dsa-desktop (Electron) │
└─────────────────────────────────────────────────────────────┘
```

---

## 一、入口层（触发与调度）

| 入口 | 说明 |
|------|------|
| `main.py` | 主调度程序：命令行入口（`--serve-only` 起 API、`--dry-run` 只取数、`--backtest` 等），内置低并发线程池调度，单股失败不影响整体 |
| `server.py` / `webui.py` | FastAPI 服务旧入口（内部走 `main.py --serve-only`） |
| `.github/workflows/` | GitHub Actions 定时分析 + 推送（零服务器部署模式） |
| `docker/` | `analyzer`（定时任务容器）与 `server`（FastAPI 容器）两种 compose 服务 |

## 二、接口层

### `api/` — FastAPI HTTP API
- `app.py` 应用装配、`deps.py` 依赖注入、`middlewares/` 中间件
- `v1/endpoints/` 按领域拆分 17 个路由：`analysis`（分析任务）、`agent`（Agent 问股）、`expectations`（预期管理）、`portfolio`（持仓）、`decision_signals`（决策信号）、`screening`（选股）、`backtest`（回测）、`alerts`（告警）、`history`、`intelligence`、`stocks`、`data`、`usage`、`system_config`、`auth`、`health`
- 职责：参数校验 → 调用 `src/services/` → 返回 Pydantic schema（`src/schemas/`）

### `bot/` — IM 机器人
- `platforms/`（Telegram/飞书等平台适配）+ `commands/`（chat、ask 等命令）+ `dispatcher.py`
- 与 API 层平级：同一套 services/agent 的另一种触发方式

## 三、智能层（AI Agent）

### `src/agent/` — 自研 Agent 执行框架（无 LangChain 等框架）
- `factory.py`：统一构建 `AgentExecutor`，API/bot/pipeline 共用（ToolRegistry 模块级缓存、SkillManager 原型 deepcopy）
- `executor.py` / `runner.py` / `orchestrator.py` / `chat_executor.py`：执行循环、编排
- `skills/` + `SkillManager`：YAML 技能（均线/缠论/波浪/热点等 15 种策略问股）
- `memory.py` / `conversation.py` / `chat_context.py`：会话记忆
- `codex_agent_backend.py`：可选 OpenAI Codex CLI 后端
- `llm_adapter.py` / `litellm_route_resolution.py`：模型路由

### `src/llm/` — 模型网关
- `litellm_backend.py`：LiteLLM 统一接入 Gemini/Anthropic/OpenAI/DeepSeek/通义/Ollama 等
- `backend_factory.py` / `backend_registry.py`：多后端注册与切换
- `local_cli_backend.py`：本地 CLI 模型；`provider_cache.py` / `usage.py`：缓存与用量统计

## 四、业务服务层

### `src/services/` — 领域服务（约 50+ 个）
按领域分组：
- **分析**：`analysis_service` / `analyzer_service` / `analysis_context_builder`（上下文包）
- **预期管理**：`expectation_service` / `expectation_scorer`（自动评分）/ `expectation_agent_service`（Agent 点评）
- **决策信号**：`decision_signal_service` / `_extractor` / `_outcome_service`（结果追踪）/ `_reassess_service`
- **持仓**：`portfolio_service`（事件流→FIFO/均价持仓）/ `portfolio_risk_service` / `portfolio_import_service`（华泰/中信/招商 CSV）
- **告警**：`alert_service` / `alert_worker` / `portfolio_alerts` / `market_light_alerts`
- **市场**：`market_hotspot_service` / `market_structure_service` / `daily_market_context` / `market_light_service`
- **通知**：`notification_*` 系列（路由/降噪/诊断/发送器 `notification_sender/`）
- **其他**：`backtest_service`、`screening/`（选股）、`intelligence_service`、`run_flow`、`history_service`

### `src/core/` — 核心引擎
- `pipeline.py`：单股分析流水线（数据获取→上下文组装→LLM 分析→报告）
- `backtest_engine.py`：回测引擎；`trading_calendar.py`：交易日历
- `market_review.py` / `market_strategy.py`：大盘复盘与策略
- `config_manager.py` / `config_registry.py`：运行时配置

### `src/` 根 — 分析器与治理
- `analyzer.py` / `stock_analyzer.py` / `market_analyzer.py`：个股与大盘分析器
- `*_guardrail.py`：交易纪律护栏（严进/趋势/效率理念硬编码检查）
- `report_language.py` / `formatters.py` / `md2img.py` / `share_image.py`：报告多语言与图片渲染
- `schemas/`：Pydantic 契约；`webui_frontend.py`：前端静态资源托管

## 五、数据访问层

- `src/storage.py`：SQLAlchemy 表定义（SQLite，写串行化锁）——分析历史、预期、信号、持仓 8 张表、告警、配置等
- `src/repositories/`：按领域的 Repo（`analysis_repo` / `alert_repo` / `backtest_repo` / `decision_signal_repo` / `portfolio_repo` 等），services 只经 Repo 访问 DB

## 六、数据源层 `data_provider/`

- `base.py`：统一行情接口契约（realtime/k线/指标/新闻/基本面）+ 回退链
- 12+ 个 fetcher：AkShare、Tushare、Baostock、Pytdx（免费内置）；TickFlow、Longbridge、Futu（token 型）；YFinance、Tencent、Efinance、Finnhub、AlphaVantage（美股/港美）
- `*_fundamental_adapter.py`：基本面数据适配；`us_index_mapping.py` / `tw_institutional_fetcher.py`：市场特化
- 免费源限流时自动回退，token 源优先

## 七、策略层 `strategies/`

15 个 YAML 策略文件：`bull_trend`（多头趋势）、`shrink_pullback`（缩量回踩）、`chan_theory`（缠论）、`wave_theory`（波浪）、`dragon_head`（龙头战法）、`emotion_cycle`（情绪周期）、`event_driven`、`expectation_repricing`、`growth_quality` 等。被 Agent SkillManager 与选股/回测消费。

## 八、推送层

- `src/notification_sender/` + `notification_routing.py` / `notification_noise.py`：企业微信、飞书、Telegram、Discord、Slack、邮件的多渠道发送、路由与降噪
- `bot/platforms/`：IM 双向交互（收指令→调 agent→回消息）

## 九、前端层 `apps/`

| 应用 | 技术栈 | 说明 |
|------|--------|------|
| `dsa-web` | React 19 + Vite 7 + TS + Tailwind v4 + Zustand | 工作台 SPA；页面：首页/Chat/选股/持仓/决策信号/预期/回测/告警/用量/设置；dev 端口 5173 代理 `/api`→8000；构建产物输出到根 `static/` 由后端托管 |
| `dsa-desktop` | Electron | 桌面壳，内嵌 dsa-web |

## 十、测试与部署

- `tests/`（pytest 后端）+ `apps/dsa-web/tests`、`e2e/`（vitest + Playwright）
- `evals/`：Agent/分析质量评估
- 部署三种形态：GitHub Actions（零服务器）、Docker（analyzer/server 双服务）、本地 venv

---

## 附：与新 feture-ui/server 的关系（可复用点）

1. **不必重写 agent**：主项目 `api/v1` 已暴露 agent/分析/预期/持仓等全部能力，新 server 若只做 BFF/聚合，直接透传 `/api/v1/*` 即可
2. **可复用的模型网关**：`src/llm/`（litellm_backend）可独立 import，新 server 需要自己的 LLM 调用时优先复用而非重接 SDK
3. **市场大事件数据源**：`data_provider/` 已有 AkShare 封装，涨停池/跌停池/昨日涨停表现可在新 server 直接调用 `data_provider` 或走主项目 `api/v1/data`
4. **契约对齐**：新前端/新 server 的 schema 建议引用 `src/schemas/` 的 Pydantic 模型，避免两套字段定义漂移
