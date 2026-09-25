# 情绪页第四轮改动方案（待审核）

> 日期: 2026-09-25 | 状态: 已实施（含附加修复：`_load_json` 对 `'null'` 字符串归位 default，修复事件落库后 `/focus` 500）
> 对应三个问题：💡 提示框色底、跌停撬板次数、市场聚焦事件为空

---

## 一、💡 结论提示框：所有档位都加色底突出

### 1.1 现状

提示框统一灰色底（`bg-muted/40`），只有阶段名文字带档位颜色，「中性」等中间档视觉上不突出。

### 1.2 方案

`StageStyle` 新增 `tipCls`（提示框背景 + 边框），五个档位全部带色底，
**靠颜色区分情绪**，与胶囊/温度数字同色系：

| 档位 | tipCls |
|---|---|
| 冰点 / 空头 | `bg-green-500/10 border-green-500/30` |
| 低迷 / 弱势 | `bg-green-400/8 border-green-400/20` |
| 中性 | `bg-amber-400/10 border-amber-400/25` |
| 活跃 / 强势 | `bg-orange-400/10 border-orange-400/25` |
| 过热 | `bg-red-500/10 border-red-500/30` |

- 短线 + 趋势两张卡同步生效；`temp === null` 不显示提示框，逻辑不变
- 仅改 `SentimentPage.tsx`，纯前端

---

## 二、跌停个股「撬板次数」不显示

### 2.1 排查结论

**数据没问题，是前端藏了。** `market_pool_detail_snapshot` 里 13 只跌停股
`break_count` 全部为 `0`（今日无一撬板），而前端渲染条件是
`s.break_count > 0` 才显示「开板 N次」，0 被隐藏 → 用户看不到任何次数。

### 2.2 方案

- `break_count !== null` 就显示（`0次` 也展示，传达「封死未撬开」）
- 文案按池区分：涨停池「开板 N次」，跌停池「**撬板** N次」（A 股语义）
- 撬板 > 0 时数值用 `text-amber-400` 加重提示（撬过板 = 封单不稳）

---

## 三、市场聚焦演化「事件」tab 拿不到数据

### 3.1 排查结论

**`market_focus_events` 表 0 行——采集流程从来没写过事件**，只写了
焦点个股（10）和热点板块（8）。读路径 `/focus` 本身正常，空是因为无数据源：

- 设计稿（storage-design.md §2.4）只定义了表结构，标注「采集时 events 追加」，
  但采集实现（`collect_daily_snapshot` 步骤 9）只落 stocks/sectors
- 现有 `data_provider` 无任何市场级新闻/快讯数据源（新闻检索 `news_intel`
  是个股维度，且 0 行）

### 3.2 方案（规则版 v1，不依赖 LLM）

**新增数据源**（已实测可用：`ak.stock_info_global_em()` 返回 200 条
标题/摘要/发布时间/链接）：

1. `data_provider/akshare_fetcher.py` 新增 `get_market_news(n)`：
   东财全球财经快讯，归一化为 `{title, summary, published_at, url, source}`
2. `data_provider/base.py` manager 新增 `get_market_news`，走
   `_fetch_pool_with_fallback` 同款 fallback（东财失败 → 新浪
   `stock_info_global_sina` 兜底）

**采集步骤**（collect 步骤 9.5，失败仅记 `degraded: ['focus_events']`）：

1. 拉当日快讯，按发布时间过滤为今日，标题去重
2. 规则打标：
   - `related_sectors`：标题/摘要命中今日热点板块名或涨停池行业词
   - `event_type`：政策/央行动词 → `policy`；业绩/财报 → `earnings`；
     指数/宏观 → `macro`；默认 `news`
   - `sentiment`：利好/大涨/新高/突破 → `positive`；利空/大跌/处罚/下修 → `negative`；默认 `neutral`
   - `impact_label`：由 sentiment 映射（利好催化 / 短期利空 / 中性关注）
3. 每日上限 20 条，`scope='week'`，走现有 `repo.add_focus_event`
   （date+title 去重，重复采集天然幂等）
4. 盘后定时采集自动生效；本轮实现后**手动补采一次**当日事件，
   页面立即可见

**说明**：规则打标的分类精度有限（v1 取向是「有得看」），
LLM 提炼摘要/影响评级留作 Phase 2（与明日重点 AI 前瞻同批挂接）。

### 3.3 改动面

| 文件 | 改动 |
|---|---|
| `data_provider/akshare_fetcher.py` | +`get_market_news` |
| `data_provider/base.py` | manager 声明 + fallback |
| `src/services/market_sentiment_service.py` | collect 步骤 9.5 + `_build_focus_events` |
| `apps/dsa-web/src/pages/SentimentPage.tsx` | 第一、二项（提示框色底 + 撬板次数） |

后端改动走 `python -m py_compile` + 手动补采验证；前端 `npm run lint + build`。

---

## 四、回滚

- 前端：`git checkout -- apps/dsa-web/src/pages/SentimentPage.tsx` 重新 build
- 后端：`git checkout -- data_provider/ src/services/market_sentiment_service.py`，
  `market_focus_events` 已有数据无需清理（表本来就存在）
