# market-sentiment — 大盘情绪页 + 预期管理

> 目标：交付一个大屏情绪页（实时市场情绪可视化），并在此基础上建设预期管理系统——记录用户自己的判断与操作预期，收盘后系统性复盘，沉淀判断质量、识别认知偏差。

## 状态

Phase 1（大盘情绪页）已实现 v0.1：7 张快照表（含三类池明细表 `market_pool_detail_snapshot`）+ `/api/v1/market-sentiment/*` 7 端点 + 采集服务 + Web 页面真数据对接。池详情端点已改为当日快照优先、盘中实时兜底，盘后加载不再实时拉源。
Phase 2（预期管理）待开工；调度接入（15:30 自动采集）待评审。

## 文档清单

| 文档 | 内容 | 状态 |
|---|---|---|
| [roadmap.md](roadmap.md) | 功能目标与路线图（大盘情绪页 → 预期管理） | v0.1（M1-M4 已落地） |
| [expectation-management.md](expectation-management.md) | 预期管理业务流程详设 | v0.1 草稿 |
| [storage-design.md](storage-design.md) | 预期管理 & 情绪页的表设计 | 情绪页部分已实现 |
| [api-call-chain.md](api-call-chain.md) | 大盘情绪页 UI → 前后端调用链设计 | v0.2（与实现对齐） |
| [ui-design.md](ui-design.md) | 页面 UI 设计（预期管理 & 交易成长系统） | v0.4 |
| [anchor-points.md](anchor-points.md) | 市场锚定点体系（价格锚：锚点窗口+转折提醒；事件锚：全球/大盘事件；个股锚：空间板/龙头断板晋级） | v0.1 草稿（待审核） |

## 相关

- 存储审计与迁移机制见 [platform/storage](../../platform/)
- 数据源现状与实时方案见 [platform/data-source](../../platform/data-source/)
- 关联功能域：[trading-growth](../trading-growth/README.md)（个人交易成长系统，与预期管理共享复盘理念）
