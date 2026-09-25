# auto-review — 每日自动复盘文案（外盘背离 + 动态过程）

> 目标：让情绪页 mockup 中的两段"作者未知"文案有明确的生产者——
> **规则引擎判定"要不要说"（触发条件、阶段标签、数值），LLM 决定"怎么说"（解读文案），收盘采集时一次生成并落库。**
> 页面读库渲染，不实时调 LLM。

## 覆盖的 mockup 区块

| mockup 文案 | 位置 | 生产者 |
|---|---|---|
| 「外盘背离：美股(隔夜)偏多 × 韩股(今晨)走弱 / 半导体链条亚太段转弱…」 | 外盘情绪卡 · 背离盒 | 规则检测背离 + LLM 解读（含美股/韩股温度与近5日轨迹） |
| 「动态过程（AI 生成）：短线情绪从 09-19 高潮(78°)连续两日回落至 32°…」 | 情绪演化主轴 · context-box | 规则判定周期阶段标签 + LLM 周期叙事 |
| 「维度背离：短线退潮 × 趋势偏多（已持续 2 日）…」 | 双维度卡下方背离盒 | 规则检测（现有 15° 阈值扩展为持续天数）+ LLM 解读 |
| 「💡 退潮：忌打板接力，等空间板企稳」「💡 偏多：可持仓趋势股，等放量突破再加仓」 | 短线/趋势情绪卡 · tip | 规则给阶段标签与条件 + LLM 一句话（通用接口场景 `sentiment.tip_*`） |

## 文档清单

| 文档 | 内容 | 状态 |
|---|---|---|
| [design.md](design.md) | 数据依赖、规则引擎、LLM prompt、表设计、API/采集链路、分期 | v0.2 草稿（外盘采集已落地；LLM 生成改走通用接口） |
| [generic-comment-api.md](generic-comment-api.md) | 通用 AI 短文案生成接口：场景注册表、统一调用契约、保护栏、全项目场景清单 | v0.1 草稿（待评审） |

## 依赖

- 采集服务：`src/services/market_sentiment_service.py collect_daily_snapshot()`（挂接在采集尾部；外盘采集 `_collect_overseas` 已落地）
- 通用短文案接口：[generic-comment-api.md](generic-comment-api.md)（M2 的 LLM 生成统一经此调用，`sentiment.review` 为首个场景）
- LLM 网关：`src/agent/llm_adapter.py LLMToolAdapter`（现有 LiteLLM 封装，通用接口底层复用）
- 数据前提：双温度/量能/梯队/炸板率快照（已落地）；池明细表 `market_pool_detail_snapshot`（已落地）

## 状态

M1 部分已随池明细改造落地：外盘采集 `_collect_overseas` → 快照 `overseas_summary`（美股 ndx/spx/dji/vix + 韩股 kospi/kosdaq），前端 OverseasCard chips 已接 `overview.overseas`。剩余按分期推进：M1 规则版（温度/轨迹、阶段标签、维度背离天数、模板文案落库）→ M2 LLM 接入（走通用短文案接口）→ M3 指标补全（晋级率、大面数、两融）。
