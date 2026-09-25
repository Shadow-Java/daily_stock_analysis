# strategy-recommendation — 用户自定义策略 + 实时 AI 推荐

> 目标：把「单只股票 → 选 3 个策略 → 出一个决策信号」扩展为「候选池（全A/自选/涨停池/热点板块）→ 用户策略集 → 批量出信号 → 按板块聚合 → 实时排序推荐板块和个股」。

## 状态

草稿

## 文档清单

| 文档 | 内容 | 状态 |
|---|---|---|
| [design.md](design.md) | 完整设计方案（模块拆分 / 数据流 / 落库 / API） | 草稿 |

## 前置阅读

- 决策信号逻辑：[trading-growth/decision-signal.md](../trading-growth/decision-signal.md)
- 实时数据方案：[platform/data-source/realtime-data-plan.md](../../platform/data-source/realtime-data-plan.md)
- 策略 YAML 机制：[knowledge/yaml-skill-design.md](../../knowledge/yaml-skill-design.md)
- Agent 工具决策链：[platform/agent/tool-decision-and-call-chain.md](../../platform/agent/tool-decision-and-call-chain.md)
