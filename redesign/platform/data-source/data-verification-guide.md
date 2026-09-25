# 数据核对指南 —— 各数据源访问的网站与正确性验证方法

> 版本: v0.1 | 日期: 2026-09-25 | 状态: 已定稿
> 关联: [data-source-audit.md](data-source-audit.md)（数据源现状） · [realtime-data-plan.md](realtime-data-plan.md)（实时数据方案）
> 用途：接入大盘情绪页等新数据面时，用本文档核对抓取数据的正确性。

---

## 一、各数据源实际访问的网站

| Fetcher | 底层网站/接口 | 网页核对入口（肉眼验证用） |
|---|---|---|
| AkShare | 背后主要是**东方财富** `push2.eastmoney.com`、**新浪** `hq.sinajs.cn`（URL 在 akshare 库内部，不在本仓库） | 涨停池 → [data.eastmoney.com/quote/ztb.html](https://data.eastmoney.com/quote/ztb.html)（东财数据中心-涨停板行情） |
| efinance | 东方财富 `push2.eastmoney.com/api/qt/stock/get` | [quote.eastmoney.com](https://quote.eastmoney.com/) 个股页 |
| TencentFetcher | `qt.gtimg.cn/q`、`web.ifzq.gtimg.cn/appstock/app/fqkline/get` | [gu.qq.com](https://gu.qq.com/)（腾讯自选股） |
| TushareFetcher | `api.tushare.pro`（需 token） | 东财网页核对即可（Tushare 亦为东财口径） |
| YfinanceFetcher | Yahoo Finance `query1.finance.yahoo.com`（在 yfinance 库内部） | [finance.yahoo.com](https://finance.yahoo.com/quote/AAPL) |
| BaoStock | 自有 TCP 协议（baostock.com），非 HTTP | 通达信/东财客户端核对收盘价 |
| PyTDX | 通达信行情服务器（7709 端口族），非 HTTP | 通达信客户端核对 |
| 台股机构 | `twse.com.tw/rwd/zh/fund/T86`、`tpex.org.tw/openapi/v1`（**官方交易所，本身就是权威源**） | 交易所官网即源头 |
| Stooq（美股备用） | `stooq.com/q/d/l/` | [stooq.com](https://stooq.com/q/d/?s=aapl.us) |
| Finnhub（美股备用） | `finnhub.io/api/v1`（需 key） | [finnhub.io](https://finnhub.io/) 查询页 |
| AlphaVantage（美股备用） | `www.alphavantage.co/query`（需 key） | [alphavantage.co](https://www.alphavantage.co/) 查询页 |
| LongbridgeFetcher | `openapi.longbridge.cn`（需账号） | 长桥 App 核对 |
| FutuFetcher | 富途 OpenD 本地网关（需 OpenD） | 富途牛牛 App 核对 |

> 本仓库代码中可直接 grep 到的域名：`qt.gtimg.cn`、`hq.sinajs.cn`、`push2.eastmoney.com`、`web.ifzq.gtimg.cn`、`api.tushare.pro`、`stooq.com`、`finnhub.io`、`alphavantage.co`、`openapi.longbridge.cn`、`twse.com.tw`、`tpex.org.tw`；akshare / yfinance / baostock / pytdx 的请求地址封装在各自 pip 库内部。

---

## 二、验证方法

### 2.1 单点核对（最直接）

拿上表"网页核对入口"，同一只股票、同一字段（最新价 / 成交额 / 涨停封单）人工对一遍。

注意：东财网页行情是延迟 1~2 分钟的 L1 快照，盘中对比会有小偏差，**收盘后对最准**。

### 2.2 多源交叉验证（项目天然支持）

`DataFetcherManager` 对同一份数据有 2~7 个源。可写脚本对同一代码只启单一 fetcher 对比：

```python
from data_provider.base import DataFetcherManager
from data_provider.tencent_fetcher import TencentFetcher
from data_provider.efinance_fetcher import EfinanceFetcher

for f in (TencentFetcher(), EfinanceFetcher()):
    print(f.name, f.get_realtime_quote("600519"))
```

判定标准：
- 最新价一致（±0.01）、成交额同量级 → 数据可信；
- 只有单源独有的数据（涨停池、龙虎榜、概念排行）→ 对照东财数据中心对应网页核对；
- 长期只有单一源成功 → 检查该源的熔断状态与可用性探测。

### 2.3 口径差异清单（"看起来不对"的最常见原因）

| 口径 | 差异点 | 核对时注意 |
|---|---|---|
| 成交额单位 | 腾讯接口"万元"、akshare 部分接口"元"、东财网页"亿元" | 先统一单位再比数值 |
| 复权方式 | 历史 K 线有前复权/后复权/不复权 | 跨源对比必须同口径 |
| 时间戳 | 盘中各源快照时间不同 | 盘后核对；盘中对比允许 1~2 分钟偏差 |
| 涨跌停价 | 四舍五入规则、ST ±5%、新股首日无限制 | 按交易所规则验算 |
| 指数代码 | 同名指数不同源代码不同（如金龙 HXC vs HSHCI） | 以 `us_index_mapping.py` 映射为准 |
| 财务数据 | 报告期截止日、TTM 计算口径 | 对照巨潮/交易所公告原文 |

---

## 三、验证结论的处理约定

- 发现某源字段口径与预期不符：先在对应 fetcher 的标准化层修正（`_normalize_*`），不改动下游消费方；
- 发现某源数据持续不可信：在 `DataFetcherManager` 的优先级/路由表中降级，而不是在业务代码里绕过；
- 新增数据面（如情绪页新接口）上线前，按 2.1 + 2.2 各验证一轮，结论回填到本文档第二节对应行。
