# data-source —— 同花顺 Financial-API 对接

> 一句话：新增同花顺官方 API 的 `ThsFetcher`，作为 A 股行情与情绪数据的第二个独立商业源。

## 文档

| 文档 | 说明 | 状态 |
|---|---|---|
| [design.md](design.md) | 对接方案：API 契约、端点映射、ThsFetcher 设计、分期实施 | 草稿（待评审） |

## 背景

现有 13 个 Fetcher 底层为东财/新浪/腾讯等，无同花顺官方源。同花顺 Financial-API（[HiThink-Tech/Financial-API](https://github.com/HiThink-Tech/Financial-API)）提供涨停池/跌停池/炸板池/龙虎榜/集合竞价等原生接口，可补齐市场情绪页数据缺口并提供交叉验证第二源。

## 关联

- 横切现状：[platform/data-source](../../platform/data-source/data-source-audit.md)
- 验证方法：[数据核对指南](../../platform/data-source/data-verification-guide.md)
