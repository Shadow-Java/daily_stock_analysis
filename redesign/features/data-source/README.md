# data-source —— 同花顺 Financial-API 对接

> 一句话：新增同花顺官方 API 的 `ThsFetcher`，作为 A 股行情与情绪数据的第二个独立商业源。

## 文档

| 文档 | 说明 | 状态 |
|---|---|---|
| [design.md](design.md) | 对接方案：API 契约、端点映射、ThsFetcher 设计、分期实施 | v0.2（P0+P1 已实现，联网联调待 key） |
| [数据需求与采集规范.md](数据需求与采集规范.md) | 项目数据需求盘点、每日收盘数据包、表设计重复/僵尸字段/幂等缺口清单与采集规范 | v0.1（草稿，待评审） |

## 背景

现有 13 个 Fetcher 底层为东财/新浪/腾讯等，无同花顺官方源。同花顺 Financial-API（[HiThink-Tech/Financial-API](https://github.com/HiThink-Tech/Financial-API)）提供涨停池/跌停池/炸板池/龙虎榜/集合竞价等原生接口，可补齐市场情绪页数据缺口并提供交叉验证第二源。

**进展**：`ThsFetcher` P0+P1 已实现（历史日 K + 三类池 + meta 搜索，配置 `HITHINK_FINANCE_API_KEY` 启用），联网联调待 key。

## 关联

- 横切现状：[platform/data-source](../../platform/data-source/data-source-audit.md)
- 验证方法：[数据核对指南](../../platform/data-source/data-verification-guide.md)
