# redesign 重构设计文档

本目录是重构 `daily_stock_analysis` 的设计文档全集：旧系统现状地图 + 新功能域设计 + 横切技术决策。

## 目录约定

| 顶层目录 | 放什么 | 判断标准 |
|---|---|---|
| `features/<功能域>/` | 我自己的需求设计 | 是某个具体需求 → 进对应功能域 |
| `platform/<专题>/` | 跨功能共享的技术决策 | 多个功能域共用 → 数据源/存储/Agent 等 |
| `architecture/` | 旧系统现状地图（读代码产出） | 重构的对照物，只读参考 |
| `design/` | 全局 UI 资产：设计哲学、mockup、logo | 跨功能的视觉/交互资产 |
| `knowledge/` | 学习笔记、机制说明 | 与项目决策无关的背景知识 |
| `deployment/` | 部署步骤 | 前后端启动/部署 |

规则：
1. 顶层只按上述维度分，禁止新增混合维度目录。
2. 功能域内按生命周期组织：`roadmap → audit → design → plan`，文件保持扁平。
3. 每份文档头部维护 `版本 / 日期 / 状态`，状态流转：`草稿 → 评审中 → 已定稿 → 实施中 → 已落地`。
4. 目录与文件命名统一英文 kebab-case。
5. 新增需求 = 新建 `features/<域>/` + 在下方功能域表格加一行。

## 功能域（我的需求）

| 功能域 | 一句话 | 状态 | 入口 |
|---|---|---|---|
| market-sentiment | 大盘情绪页 + 预期管理 | 设计中（待评审） | [features/market-sentiment](features/market-sentiment/README.md) |
| trading-growth | 个人交易成长系统 | 草稿 | [features/trading-growth](features/trading-growth/README.md) |
| strategy-recommendation | 用户自定义策略 + 实时 AI 推荐板块/个股 | 草稿 | [features/strategy-recommendation](features/strategy-recommendation/README.md) |
| ui-layout | UI 风格重构：浅色默认 + 实体图标 + 对齐设计稿 | 方案待评审 | [features/ui-layout/design.md](features/ui-layout/design.md) |
| data-source | 同花顺 Financial-API 对接：新增 ThsFetcher | 草稿 | [features/data-source](features/data-source/README.md) |

## 横切技术

| 专题 | 文档 |
|---|---|
| 数据源 | [现状审计](platform/data-source/data-source-audit.md) · [实时数据方案](platform/data-source/realtime-data-plan.md) · [数据核对指南](platform/data-source/data-verification-guide.md) |
| 存储 | [存储审计](platform/storage/storage-audit.md) · [模型与迁移机制](platform/storage/storage-migration.md) |
| Agent | [工具决策与 UI→Agent 调用链](platform/agent/tool-decision-and-call-chain.md) |

## 旧系统地图（architecture/）

- [架构总览](architecture/architecture.md) — 各层级职责与复用点
- [API 调用链路](architecture/api-call-chain.md) — 前端到后端三条主链路
- [Agent 架构](architecture/agent-architecture.md) — src/agent/ 结构

## 全局设计（design/）

- [设计哲学](design/philosophy.md)
- [UI Mockup](design/ui-mockup.html) · [logo/assets](design/assets/)

## 知识笔记（knowledge/）

- [ReAct 循环与 reply_stream 事件流](knowledge/react-loop-and-reply-stream.md)
- [策略 YAML 机制说明](knowledge/yaml-skill-design.md)

## 部署（deployment/）

- [后端](deployment/backend.md) · [前端](deployment/frontend.md) · [macOS 快速启动](deployment/macos-quickstart.md)
