# 同花顺 Financial-API 对接方案 —— 新增 ThsFetcher

> 版本: v0.4 | 日期: 2026-09-25 | 状态: P0+P1 已实现；指数快照提前自 P2 落地并作为 A 股指数优先源（情绪页沪深成交额拆分生效，见 §7.1-6）；首轮联网联调完成（K线/meta/快照 ✅ 并已修列名映射；三池接口 THS 侧空返回待开通确认，见 §7.1-2）
> 上游项目: [HiThink-Tech/Financial-API](https://github.com/HiThink-Tech/Financial-API)（同花顺官方开放 API，文档站 fuyao.aicubes.cn）
> 关联: [数据源现状审计](../../platform/data-source/data-source-audit.md) · [数据核对指南](../../platform/data-source/data-verification-guide.md) · [实时数据方案](../../platform/data-source/realtime-data-plan.md)
> 目标：在 `data_provider/` 新增同花顺官方 API 的 Fetcher，作为 A 股行情与情绪数据的第二个独立商业源，补齐涨停/跌停/炸板池等缺口。

---

## 一、结论先行

| 事项 | 结论 |
|---|---|
| 现状确认 | 现有 13 个 Fetcher **均无同花顺官方 API**（`data-source-audit.md` 第一节），akshare/efinance 底层是东财/新浪 |
| 接入方式 | **直接 REST HTTP**（仿 `tushare_fetcher.py` 的 `_TushareHttpClient` 模式），不用 Python SDK（git 子仓库 monorepo 太重），不用 MCP（留给未来 Agent 工具层） |
| 落地形态 | 新文件 `data_provider/ths_fetcher.py`，类 `ThsFetcher(BaseFetcher)`，注册进 `DataFetcherManager` |
| 覆盖范围 | **仅 A 股**：实时快照、历史日 K、涨停池/跌停池/炸板池/连板天梯、龙虎榜、热榜、集合竞价、指数、概念/行业目录、估值、财务 |
| 核心价值 | ① 涨停/跌停/炸板池获得**第二个独立源**（与 akshare 东财口径交叉验证，见核对指南 §2.2）；② 龙虎榜/热榜多一个直连源；③ 集合竞价快照是独有能力 |
| 关键限制 | A 股 only（无港美股、无分钟线/tick、无两融余额）；快照**无股票名称**（需 meta 搜索接口补名）；历史 K 线**无涨跌幅字段**（需自行推导）；K 线单次窗口 ≤10 年 |
| 配置项 | `HITHINK_FINANCE_API_KEY`（不配置 → `is_available=False`，静默跳过，符合"不配置也可运行"） |
| 实施分期 | P0 骨架+快照+历史K → P1 涨跌停/炸板池 hooks → P2 指数/估值/财务（详见第七节） |

---

## 二、同花顺 Financial-API 概览

### 2.1 接入要素

| 要素 | 值 |
|---|---|
| Base URL | `https://fuyao.aicubes.cn` |
| 认证 | 请求头 `X-api-key: <key>`（控制台申请，按套餐计费） |
| 协议 | 全部 REST GET/POST，JSON |
| 响应信封 | `{"code": 0, "message": "ok", "request_id": "...", "data": {"timestamp": <ms>, "item": [...]}}` |
| 字段风格 | snake_case |
| 时间戳 | **毫秒** Unix，东八区（Asia/Shanghai） |
| MCP 入口 | `/mcp/a-share`、`/mcp/a-share-index`、`/mcp/fund`、`/mcp/meta`（共 55 个工具，本方案不用） |
| 批量导出 | `/api/dump/market-dumps/**`（Parquet 全市场快照，P2 备选） |

### 2.2 错误码与本项目异常映射

**重要：所有业务错误均返回 HTTP 200**，靠 `code` 字段区分。映射到 `data_provider/base.py` 已有异常体系，让熔断器/限流器复用现有逻辑：

| code | 含义 | 映射到本项目 |
|---|---|---|
| 0 | 成功 | 正常返回 |
| 1001/1002/1003/1004 | 参数缺失/格式/范围/冲突 | `DataFetchError`（编程错误，打日志即可，不应重试） |
| 2001/2003 | 未认证/无权限 | `DataFetchError` + **标记 fetcher 不可用**（key 失效，熔断长冷却） |
| 3001/3002/3004 | 未找到/未就绪/不支持 | 返回空/None（与现有 hooks"无数据返回 None"语义一致） |
| **4001** | **QPS 超限** | **`RateLimitError`** → 复用现有 tenacity 退避 + 熔断冷却（与 Tushare 同套路） |
| 5001~5003 | 服务端错误 | `DataFetchError`，走 tenacity 指数退避重试 |

### 2.3 覆盖范围与限制（决策依据）

**有的**：A 股实时快照（批量）、历史日 K（前/后/不复权）、涨停池/跌停池/炸板池/连板天梯、龙虎榜（机构/游资维度）、热股榜（日/小时）、妖股榜、异动分析、集合竞价（live/final）、指数快照与历史、同花顺概念/行业/地域指数目录与成分股、代码搜索、估值快照（PE/PB/PS/PCF）、财务三表、交易日历。

**没有的**（相对现有 akshare/efinance 是退化或空白，不做迁移理由）：
- 港股/美股/台股 —— 现有 yfinance/tencent 等已覆盖，ThsFetcher 市场集合固定 `{"cn"}`；
- 分钟线 / tick —— 现系统不消费；
- 两融余额 —— 情绪页缺口仍需走 akshare `stock_margin_sse/szse`（audit 缺口 #2 与本方案无关）；
- 快照无 `name` 字段 —— 需要 `/api/meta/tickers/search?q=` 换名称，或直接不返回名称由上层 join；
- 历史 K 线无 `pct_chg` —— 在 `_normalize_data` 中由相邻收盘价推导（与部分现有 fetcher 做法一致）。

---

## 三、端点 → 本项目能力映射

> 星号 = 本方案落地目标；其余为后续扩展候选。

| THS 端点 | 关键参数 | 返回核心字段 | 对应 BaseFetcher 能力 | 分期 |
|---|---|---|---|---|
| `/api/a-share/prices/snapshot` | `thscodes=`（逗号分隔批量） | 最新价/开高低/成交量额/涨跌 | `get_realtime_quote`（经 Manager 门面） | P0 |
| `/api/a-share/prices/historical` | `thscode`、`interval=1d`、`start/end`（ms）、`adjust=forward`、offset 分页 | OHLCV（**无 pct_chg**） | `_fetch_raw_data` + `_normalize_data` | P0 |
| `/api/a-share/special-data/limit-up-pool` | `page/size`(≤200)、sort 白名单 | 涨停时间(HH:MM)、涨停原因、连板数 `continue_day_cnt`、封单 `seal_money`/`max_seal_money` | `get_limit_up_pool` | P1 |
| `/api/a-share/special-data/limit-down-pool` | 同上 | 首/末次跌停时间 | `get_limit_down_pool`（**基类 hook 已存在**，base.py:452，仅缺实现者） | P1 |
| `/api/a-share/special-data/limit-break-pool` | 同上 | `open_times`（炸板次数） | `get_blown_pool`（**hook 已存在**，base.py:478） | P1 |
| `/api/a-share/special-data/limit-up-ladder` | 无参数 | 近 30 日连板天梯矩阵（two_board…seven_over） | 情绪页"连板梯队"新数据面（audit 未覆盖） | P1 |
| `/api/a-share/special-data/dragon-tiger-list` | `board_type=all/org/hot_money`、`date` | 龙虎榜明细 | 龙虎榜第二源（现仅 akshare） | P2 |
| `/api/a-share/special-data/hot-stock-list` | `period=day/hour` | Top30 热股 | `get_hot_stocks` 第二源 | P2 |
| `/api/a-share/auction/snapshot` | `stage=live/final` | 竞价快照 | 独有能力，情绪页开盘前数据面 | P2 |
| `/api/a-share-index/prices/snapshot` / `historical` | `thscodes=`（逗号分隔批量）/ `thscode`、`interval=1d`、start/end（ms） | 指数行情（`last_price/price_change/price_change_ratio_pct/volume/turnover`，**无 name 字段**，本地 `_THS_INDEX_CODES` 映射） | `get_main_indices(region="cn")`（**已实现**，Manager cn 门面 THS 优先源）；historical 未接 | P2 提前落地 ✅ |
| `/api/a-share-index/catalog/ths-index-list` | `tag=cn_concept/industry/region/tszs` | 同花顺概念/行业指数目录 | `get_concept_rankings` / 板块聚合（**注意口径与东财概念不同**） | P2 |
| `/api/meta/tickers/search` | `q=`（名称/代码） | 代码消歧 + **名称** | 快照补名的辅助通道 | P1（随池子一起） |
| `/api/a-share/valuations/snapshot` | 批量 ≤100 | PE/PB/PS/PCF | 估值数据面（现无直连接口） | P2 |
| `/api/a-share/financials/*` | 报告期 | 财务三表 | `fundamental_adapter` 备选源 | P2 |
| `/api/a-share/calendar/trading-days` | 无参数（固定近 1 年） | 交易日列表 | 交易日校验辅助 | P2 |

> 不接：分钟线、tick、两融、港美股、`/api/fund/**`（基金，与现系统无关）、Parquet dumps（P2 评估批量回填场景再用）。

---

## 四、ThsFetcher 设计

### 4.1 类结构（完全对齐 BaseFetcher 契约，base.py:331-610）

> **v0.2 实现记录**（P0+P1 已落地 `data_provider/ths_fetcher.py` + `tests/test_ths_fetcher.py`，与下述草图的三处偏差）：
> 1. `name = "ThsFetcher"`（非草图的 `"ths"`）：`_DAILY_MARKET_FETCHER_SUPPORT` 键用类名风格，且港/美日线路径按该表跳过不支持市场
> 2. `is_available` 为**方法**（镜像 Tushare 写法；Manager 探针对 property/method 均兼容）
> 3. 配置读取走 `src/config.py`（`hithink_finance_api_key` / `hithink_finance_api_url` 字段），非裸 `os.getenv`；URL 环境变量 `HITHINK_FINANCE_API_URL` 校验逻辑与 `TUSHARE_HTTP_URL` 一致（`_resolve_ths_base_url`）
> 另：认证失败（2001/2003）置进程内 `_auth_failed` 长冷却（`is_available()` 转 False），瞬时错误由 Manager CircuitBreaker 兜底；池类 `date` 参数归一为 `YYYY-MM-DD`，**留空不传**（端点默认最新交易日）；历史 K 线 volume/amount **透传不换算**（单位待联网核对后在 `_normalize_data` 单点换算）；池 item 字段名按 §三 记录值写候选键映射（`_first_of` 集中维护），真调后收敛。

```python
# data_provider/ths_fetcher.py
class ThsFetcher(BaseFetcher):
    name = "ths"
    priority = 99          # 默认垫底；配置 key 后动态前移（见 5.2）

    def __init__(self):
        self._client = _ThsHttpClient(
            api_key=os.getenv("HITHINK_FINANCE_API_KEY", ""),
            base_url=os.getenv("HITHINK_FINANCE_API_URL", "https://fuyao.aicubes.cn"),
        )

    @property
    def is_available(self) -> bool:
        return bool(self._client.api_key)      # 不配置 → False，Manager 直接跳过

    # ---- BaseFetcher 抽象方法 ----
    def _fetch_raw_data(self, stock_code, start_date, end_date) -> pd.DataFrame: ...
    def _normalize_data(self, df, stock_code) -> pd.DataFrame: ...

    # ---- 可选能力 hooks（返回 None 即"无此能力"）----
    def get_limit_up_pool(self, date=None, n=20): ...
    def get_limit_down_pool(self, date=None, n=20): ...
    def get_blown_pool(self, date=None, n=20): ...
```

### 4.2 HTTP 客户端（镜像 `_TushareHttpClient`，tushare_fetcher.py）

```python
class _ThsHttpClient:
    """同花顺 Financial-API 轻量客户端：SDK-free，requests 直连。"""

    def request(self, path: str, params: dict) -> list[dict]:
        res = requests.get(self._base_url + path, params=params,
                           headers={"X-api-key": self._api_key}, timeout=30)
        res.raise_for_status()                      # 网络层错误走 tenacity 重试
        body = res.json()
        code, message = body.get("code"), body.get("message", "")
        if code == 0:
            return body["data"]["item"]
        if code == 4001:
            raise RateLimitError(f"ths QPS exceeded: {message}")     # → 熔断冷却
        if code in (2001, 2003):
            raise DataFetchError(f"ths auth failed: {message}")      # → 长冷却 + 标记不可用
        if code in (3001, 3002, 3004):
            return []                               # 无数据/未就绪/不支持 = 空，不抛
        raise DataFetchError(f"ths error {code}: {message}")
```

复用 `tushare_fetcher.py` 已有的整套基建：tenacity 指数退避、每分钟配额计数、`_resolve_*_url()` 环境变量校验（http/https 前缀）。导入项与 Tushare 一致：`DataFetchError, RateLimitError, STANDARD_COLUMNS, normalize_stock_code`。

### 4.3 thscode 转换规则

同花顺代码带交易所后缀（`600519.SH`），本仓库内部统一为裸 6 位。转换放在 fetcher 入口，**港美股早期拒绝**（避免走到 HTTP 才失败）：

| 内部代码 | thscode | 规则 |
|---|---|---|
| `600519` | `600519.SH` | 6 开头 → SH |
| `000001` / `300750` | `000001.SZ` / `300750.SZ` | 0/3 开头 → SZ |
| `830799` / `430047` | `830799.BJ` / `430047.BJ` | 4/8 开头 → BJ |
| `hk00700` / `AAPL` | — | **直接 raise / 返回 None**（`_is_hk_market` 等判断前置） |

反向（接口返回 → 内部）取 `.` 前缀即可。入参标准化统一走 `normalize_stock_code`，不另造轮子。

### 4.4 字段映射要点

| 本项目标准列 | THS 来源 | 备注 |
|---|---|---|
| `date` | ms 时间戳 | `pd.to_datetime(..., unit="ms")`，东八区 |
| `open/high/low/close` | 同名 snake_case | 直取 |
| `volume` / `amount` | 同名 | **口径核对**：股/手、元/千元，落地时按核对指南 §2.3 先验单位再入库 |
| `pct_chg` | **接口无** | `_normalize_data` 中 `close.pct_change() * 100` 推导；首行为 NaN 由 `_clean_data` 兜底 |
| 复权 | `adjust=forward` | 与主用源（东财前复权）对齐口径，避免跨源对比失真 |
| K 线窗口 | ≤10 年 | `_fetch_raw_data` 若跨度超限，按 10 年截断并打 warning（现有使用者最多取 2~3 年） |

---

## 五、注册、配置与优先级

### 5.1 配置项（同步更新 `.env.example`）

| 变量 | 默认 | 语义 |
|---|---|---|
| `HITHINK_FINANCE_API_KEY` | 空 | 同花顺 API key；**空 = 整个 fetcher 不可用，零影响** |
| `HITHINK_FINANCE_API_URL` | `https://fuyao.aicubes.cn` | 仅测试/代理场景覆盖 |

### 5.2 注册进 DataFetcherManager

在 Manager 的 fetcher 列表注册 `ThsFetcher()`（同 Tushare 位置与写法）；优先级策略照抄 Tushare 的"**动态 boost**"模式：默认 `priority=99` 垫底，仅当配置了 key 时前移到 Tushare 相邻档位。这样：

- 未配置 key 的用户：行为与今天完全一致（回滚零成本）；
- 配置了 key：A 股历史 K 线多一个 fallback 源，Manager 的 fan-out 自动容错。

### 5.3 限流与熔断

- 套餐有 QPS 限制 → `code=4001` 抛 `RateLimitError`，现有 tenacity 退避 + 熔断冷却直接生效；
- `2001/2003`（key 失效/无权限）抛 `DataFetchError` 并**置长冷却**（避免每轮分析都撞一次认证失败）；
- 池类接口（P1）调用频率低（每日几次），不构成限流压力；快照批量接口单次 ≤ 上限条数，注意分批。

---

## 六、与市场情绪页的关系

对照 `data-source-audit.md` 第三节的缺口清单：

| audit 缺口 | THS 能否补 | 说明 |
|---|---|---|
| #1 炸板池 / 跌停池 / 昨日涨停 | ✅ 炸板/跌停池有原生接口 | 昨日涨停表现 THS 无对应端点，仍走 akshare `stock_zt_pool_previous_em` |
| #2 两融余额 | ❌ | THS 无两融，走 akshare |
| #3 美股 SOX/金龙 | ❌ | THS A 股 only，走 `us_index_mapping.py` |
| #4 量能/新高新低历史 | 部分 | 指数历史 K 可辅助量能轨迹 |

**额外红利**：涨停/跌停/炸板池从"akshare 单源"变为"akshare(东财) + THS 双源"——正好落在数据核对指南 §2.2 的多源交叉验证框架里（两源不一致 → 按 §三 约定回填核对文档）。连板天梯（30 日矩阵）和集合竞价快照是 THS 独有数据面，可作情绪页 v2 素材，但**不在本方案范围**，由情绪页 roadmap 单独决策。

Agent 工具化（把 `get_limit_up_pool` 等包装成 agent tool）见 audit 第四节，与本方案解耦，先行落地数据层。

---

## 七、实施分期

| 阶段 | 内容 | 改动面 | 验收 |
|---|---|---|---|
| **P0 ✅** | `_ThsHttpClient` + `ThsFetcher` 骨架（`_fetch_raw_data`/`_normalize_data`/`is_available`）+ Manager 注册 + `.env.example` | 新增 1 文件，改 3 处（Manager、`.env.example`、`src/config.py`） | 离线单测 32 项通过（`tests/test_ths_fetcher.py`）；联网项见 §7.1 |
| **P1 ✅** | 涨停/跌停/炸板池 hooks + meta 搜索补名 | 同一文件内追加 | 离线单测覆盖契约/时间归一/boards 字段；联网交叉比对见 §7.1 |
| **P2** | 指数、龙虎榜、热榜、集合竞价、估值/财务、概念目录 | 按需逐个 hook | 逐接口按核对指南 §2.1 单点核对 |

### 7.1 联调补验清单

**首轮联调结果（2026-09-25，fuyao.aicubes.cn，正式 key）：**

1. 历史日 K ✅：真实列名 `date_ms` / `open_price` / `high_price` / `low_price` / `close_price` / `volume` / `turnover`；单位核对 **volume=股、turnover(=amount)=元**（600519 交叉验证 amount/volume ≈ 收盘价），与项目标准一致，透传不换算；`_normalize_data` 已加 `_THS_KLINE_ALIASES` 列名映射（本次联调修复的唯一代码缺口）
2. 涨/跌/炸板池 ⚠️：三端点均 `code=0` 但 `pagination.total=0`（无 date、date=09-24、历史 date=09-10 皆空）；同模块**连板天梯（30 条）/ 热榜（30 条）有数据** → 接口路径与参数正确（服务端正常回显分页），疑似 key 的池数据集未开通或 THS 侧停服，**需联系同花顺确认**；`_first_of` 候选键维持 design §三 记录值，拿到真实样本后再收敛；回填核对指南 §2.2 的交叉比对相应顺延
3. meta 搜索 ✅：`/api/meta/tickers/search` 返回 `thscode/ticker/name/exchange/asset_type/currency/list_date`，可直接供快照补名
4. 实时快照 ✅（P2 备查）：字段 `thscode/ticker/volume(股)/turnover(元)/last_price/open_price/high_price/low_price/prev_price/price_change/price_change_ratio_pct`
5. 错误码 2001/2003 / 4001：有效 key 未触发，保持待验（离线单测已覆盖映射逻辑）
6. 优先级 boost ✅：配置 key 后日志确认 `ThsFetcher 优先级提升为 2`；Manager 排序位置待下轮真实分析任务观察
7. 指数快照 ✅（提前自 P2 落地）：`/api/a-share-index/prices/snapshot` 批量 `thscodes=` 一次拉 8 指数（000001.SH/000016.SH/000300.SH/399001.SZ/399006.SZ/000688.SH/399106.SZ/899050.BJ，未知代码服务端自动忽略）；返回**无 name 字段**，本地 `_THS_INDEX_CODES` 映射；**turnover=对应市场总额**（000001.SH=沪市总额、399001.SZ/399106.SZ=深市总额同值，与 DB `total_amount` 16689 亿 ≈ 沪 7836+深 8697 亿互验）；`Manager.get_main_indices(region="cn")` 门面 THS 先行（镜像 tickflow 先例），失败回落 efinance/akshare/tickflow；情绪页 `_parse_indices` 仅取 `上证指数`/`深证综指` 行拆分 `sh_amount`/`sz_amount`（亿元），**明确拒绝深证成指**（部分源为成份股口径，避免跨源语义漂移）

**遗留待验（下轮补）：**

- 历史日 K 与东财对照（价格 ±0.01）
- 池类接口开通后：与 akshare 同日列表交叉比对（家数/代码集/首封时间），结论回填核对指南 §2.2，收敛 `_first_of` 候选键
- 无效 key 触发 2001/2003 的 `_auth_failed` 长冷却实测；4001 熔断路径观察

每阶段独立 commit、独立可回滚；P0 合入后若线上异常，`git revert` 单提交即可，且未配置 key 的部署完全不受影响。

---

## 八、风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 商业 API 计费/QPS 超限 | 调用失败或产生费用 | 4001→RateLimitError 熔断冷却；池类低频调用；key 不配置即完全停用 |
| 口径差异（手/股、千元/元、复权） | 跨源对比失真 | 核对指南 §2.3 先验单位；`_normalize_data` 集中换算，不动下游 |
| 快照无名称字段 | 前端展示缺名称 | P1 meta search 补名；或池类接口自带名称的字段直用 |
| key 失效/欠费 | 该源持续失败 | 2001/2003 → 长冷却 + `is_available` 降级，不拖垮主流程（稳定性护栏 §7） |
| THS 停服/接口变更 | 单源失效 | 本就定位为**第二源**，失效仅退化回现有 akshare/efinance 路径，Manager fan-out 自动兜底 |

**回滚方式**：`git revert` 对应提交；配置层面删除 `HITHINK_FINANCE_API_KEY` 即逻辑下线（fetcher 不可用），无需回滚代码。

---

## 九、方案对比（为什么是 REST 直连）

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **REST 直连**（选定） | 与 `_TushareHttpClient` 同套路、零新依赖、错误码/限流可控、改动面最小 | 要自己维护字段映射 | ✅ 采用 |
| 官方 Python SDK | 省去 HTTP 细节 | 该仓库是 monorepo（含 Java/Go 多语言 SDK），Python 侧为 git 子依赖，引入重、更新被动 | ❌ |
| MCP（`/mcp/a-share`） | 55 个工具开箱即用 | MCP 面向 Agent 工具层，不属于 `data_provider` fetcher 契约；行情高频调用走 MCP 多一层抽象与开销 | ❌（留作未来 Agent 接入候选） |
| Parquet dumps | 全市场批量最省请求 | 只适合离线回填，不适合实时路径 | ❌（P2 仅评估回填场景） |
