# operation-advisor — AI 操作建议（每日操作参谋）

> 目标：基于当前行情，AI 给出「今天该不该做、用什么打法做、买什么、我该持仓还是减仓」的完整操作建议——持仓比例建议、买入/卖出提示、买入可能性最高的板块 TopN 与个股 TopN，以及按打法（低吸/追高/打板）分组的候选股名单与每日动态打分。

## 状态

草稿（design.md v0.1 待评审，未开工）

## 文档清单

| 文档 | 内容 | 状态 |
|---|---|---|
| [design.md](design.md) | 完整设计（打法路由 / 打分体系 / 持仓建议 / 存储 / API / 分期落地） | v0.1 草稿 |
| [scoring-and-evolution.md](scoring-and-evolution.md) | 评分系统与演变规则细化规格（阶段状态机 / 因子公式与权重 / 性价比与结论阈值 / 观察池进出池与轨迹演变） | v0.1 草稿 |
| [prediction.md](prediction.md) | 明日走势预测（市场层阶段转移概率 / 板块延续性 / 个股剧本概率化 / 次日对账与预测战绩闭环） | v0.1 草稿（待评审） |

## 前置阅读

- 大盘情绪页与数据采集现状：[market-sentiment/README.md](../market-sentiment/README.md)
- 市场锚定点（空间板/龙头断板/事件锚）：[market-sentiment/anchor-points.md](../market-sentiment/anchor-points.md)
- 用户自定义策略 + 实时推荐（兄弟功能，共享扫描思想）：[strategy-recommendation/design.md](../strategy-recommendation/design.md)
- 决策信号原始想法（低吸/赚钱效应/竞价强度笔记来源）：[trading-growth/decision-signal.md](../trading-growth/decision-signal.md)
- UI 设计规范（本功能前端需遵守）：[ui-layout/design.md](../ui-layout/design.md)

## 相关

- 与 `strategy-recommendation` 的边界：该功能是「用户自定义策略驱动的实时推荐引擎」；本功能是「系统内置的每日操作参谋」，偏「判断 + 仓位 + 打法」，二者阶段 3 可共享扫描层。
- 存储审计：`decision_signals` 系列表（持仓股买卖提示复用，不新建平行实现）。


