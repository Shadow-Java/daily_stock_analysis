# UI 风格重构 — 设计系统 v0.3（字阶 / 强调 / 密度）

> 版本: v0.3 | 日期: 2026-09-25 | 状态: 实施中（阶段 0/1/2、4 批次一已实施，待双主题走查）
> v0.1（默认浅色 + 实体图标 + 对齐设计稿）结论仍然有效，合并为前置阶段（见 §七）。
> 本版核心：解决全站 **"字小、重点弱、层级平"** 的系统性问题。
>
> **本文档为 UI 设计单一真源。** 原 `../tmp/sentiment-ui-round5-plan.md`（功能语义史）、
> `../tmp/sentiment-ui-round6-plan.md`（市场聚焦修缮）、
> `../tmp/sentiment-week-month-events-ui-mockup.html`（设计稿原型）中的
> 设计原则与组件规范已全部并入本文档，三个文件可安全删除。
>
> 病例页 / 参照实现：大盘情绪 · 市场聚焦
> （`apps/dsa-web/src/pages/SentimentPage.tsx` 的 MarketFocus 组件，已按本规范实施）。

---

## 一、诊断：为什么全站显得"字小、没重点"

### 1.1 全局隐性缩放（根因）

`apps/dsa-web/src/index.css` 中：

```css
html { font-size: 14px; }
```

所有 rem 类被隐性打 87.5 折：`text-xs`（名义 12px）实际 **10.5px**、
`text-sm` 实际 12.25px、`p-4` 实际 14px。整个应用在标准 Tailwind 字阶上
整体缩水，而代码里完全看不出来——这是"觉得字小"的第一根因。

### 1.2 子像素字号泛滥

在缩放之上，代码又大量使用 9.5/10/10.5px 字面值：

- `SentimentPage.tsx` 单页曾有 **56 处** ≤11px 类（市场聚焦段已清零）；
- 全站约 **20 个文件**存在 `text-[9.5px]` / `text-[10px]` / `text-[10.5px]`。

结果：正文、标题、meta、chip 挤在 9.5~12px 区间，字阶坍缩。

### 1.3 层级靠透明度，不靠字号字重

强调一律用低透明度：`bg-red-400/5` + `border-red-400/25`。浅色主题下
5% 透明度底几乎不可见。**透明度只能做辅助，强调的主通道必须是字号、
字重和实色。**

### 1.4 数字不突出

涨跌幅、连板数、时间等数据主角与普通 meta 同字号同字重；榜单没有 rank
视觉锚点；数字没有全局 `tabular-nums` 约定。

### 1.5 层级倒置的 tab

页面内普遍存在"内层控件比外层更响"的问题（内层描边按钮 vs 外层弱底色）。
**终审结论：内层 tab 与外层 scope 使用同一规格分段控件、占满宽度，**
**不靠尺寸差异表达层级（见 §5.1）。**

---

## 二、设计原则（4 条，全站约束）

1. **一屏三级字**：标题级（15px+）、正文级（12.5~13px）、辅助级（11~12px），
   同屏内每级只允许一个字号档；**<11px 全站禁止**。
2. **强调三通道**：结构（字号/字重/独立成行）、色彩（语义实色）、位置
   （关键数字右对齐放大）。禁止只用"小字 + 低透明度"表达重点。
3. **数字优先**：数据密集页中，涨跌幅/连板数/时间是视觉主角，
   主数字 ≥ 标题字号，一律 `tabular-nums`。
4. **语义色固定**：红涨绿跌（A 股惯例）由统一 token 承载
   （`--color-up` / `--color-down`，沿用 v0.1 §4.1 已拍板决策，待落地），
   与 success/danger（状态语义）解耦。

---

## 三、字阶 token（literal px，可预测、不受 html 字号缩放影响）

字号一律用**字面 px 任意值类**（不受 html font-size 缩放影响）：

| token | 类名 | 字号/字重 | 用途 |
|---|---|---|---|
| display | `text-[17px] font-bold` | 17/700 | 页面标题 |
| title | `text-[15px] font-bold` | 15/700 | 卡片标题（明日重点聚焦等） |
| section | `text-[12px] font-bold` | 12/700 | 分组标题 / 日期带 |
| body-strong | `text-[13px] font-semibold` | 13/600 | 列表主文字 / 事件标题 |
| body | `text-[12.5px]` | 12.5/400 | 正文 / 阅读性内容 |
| secondary | `text-[11.5px] text-secondary-text` | 11.5/400 | 摘要 / 描述 |
| caption | `text-[11px]` | 11/400 | 时间 / 来源 / meta |
| chip（最小） | `text-[11px] font-semibold` | 11/600 | 徽章 / 标签 |

配套硬规则：

- 新代码禁止出现 `text-[9.5px]` / `text-[10px]` / `text-[10.5px]`；
- 数字列（价格、涨跌幅、连板数、日期时间）一律 `tabular-nums`；
- 强调色底透明度下限 8%（`/[0.08]`），边框下限 30%（`/30`）；
- 深色模式：新增样式必须双主题可读（统一用 `-400/xx` 别名色，两主题已各自映射）。

### 阶段 0：恢复 html 字号（1 行，最大杠杆）

```css
/* 删除 index.css 中 */
html { font-size: 14px; }
```

恢复标准 rem 基准后，`text-xs`=12px、`text-sm`=14px 正常工作，存量页面的
间距也回归标准密度。存量 rem 类页面无需立刻迁移字面 px 类，按页面逐步
走查收敛（§七 阶段 4）。

---

## 四、强调系统（组件级规范）

### 4.1 关键事件卡（重点关注级）

```tsx
'rounded-lg border p-3 space-y-1'
+ 'bg-red-400/[0.08] border-red-400/40 border-l-[3px] border-l-red-400'
+ chip / 标题前缀 ⭐，标题 body-strong（13/600，独立成行）
```

左侧 3px 实色边是关键卡的识别符，缩略图/半屏下仍可扫读。
非重点卡：`bg-card border-border/40`；延续关注卡：`bg-muted/30 border-border/40`。

### 4.2 影响级 chip（页面扫读锚点）

```tsx
// 统一 text-[11px] font-semibold px-2 py-0.5 rounded-md，杜绝与 meta chip 同权
重点关注: 'bg-red-400/10 text-red-400 ring-1 ring-red-400/30'
全球关注: 'bg-[hsl(var(--primary))]/10 text-primary ring-1 ring-primary/30'
延续关注: 'bg-slate-400/10 text-slate-400'
```

### 4.3 榜单 rank 卡

- rank 方块：`w-6 h-6 rounded-md bg-muted text-[12px] font-bold
  flex items-center justify-center`，第一名 `bg-red-400/10 text-red-400`；
- 第一名整卡 `border-red-400/40 bg-red-400/[0.06]`；
- 主数字（涨跌幅）：`text-[15px] font-extrabold tabular-nums text-right shrink-0`，
  红涨 `text-red-400` / 绿跌 `text-green-400`；
- 名称/龙头/meta 两行布局，meta `text-[11px] text-secondary-text`；
- 个股卡另加连板徽章：`text-[11px] font-extrabold px-2 py-0.5 rounded-md
  bg-gradient-to-br from-red-400/15 to-orange-400/15 text-red-400
  ring-1 ring-red-400/30`，≥5 板前缀 👑。

### 4.4 分组带

- 日期分组：实底带 `rounded-md bg-muted/60 border border-border/30 px-2.5 py-1.5`
  + `section` 字号 + 星期（`text-[11px] text-secondary-text`）+ 右置计数；
- 空档占位：该组无内容时渲染虚线占位卡
  `border-dashed text-[11.5px] text-secondary-text`，文案说明原因
  （如「无重点日程（休市或无重要数据发布）」）；
- 回顾分隔：虚线 + `section` 字号弱化色（`text-secondary-text`）；
- 假期带（预留，待后端补假期标记字段）：`bg-amber-400/10 border-amber-400/30 text-amber-500`。

### 4.5 回溯提示（LookbackNote，全站唯一实现）

`bg-amber-400/10 border border-dashed border-amber-400/40 text-[11.5px] text-amber-500
rounded-lg px-3 py-2`——禁止各页面自定义回溯/提示样式。

---

## 五、组件规范

### 5.1 分段控件（唯一规格，全宽）

> 终审结论：页面内内容 tab（事件/板块/个股）与 scope 切换（明日/周/月）
> 使用**同一规格**分段控件，一律占满可用宽度。层级靠位置与分组语境表达，
> 不靠尺寸差异；**禁止内层用描边按钮、禁止 w-fit 缩窄**。

| 属性 | 规格 |
|---|---|
| 容器 | `flex gap-1 p-1 rounded-lg bg-muted/70` |
| 按钮 | `flex-1 text-center py-2 px-3 rounded-md text-[13px] font-medium transition-all` |
| active | `bg-card text-foreground font-semibold shadow-sm` |
| inactive | `text-secondary-text hover:text-foreground` |

筛选型导航（如周聚焦的 全部/今天/周一~周六）用同构小号 pill：
`text-[11.5px] px-3 py-1 rounded-md`，选中态同 active，未选中 `text-secondary-text`。

### 5.2 卡片

`rounded-xl border border-border/50 bg-card p-4`（容器）/
`rounded-lg border border-border/40 bg-card px-3 py-2.5`（列表卡）+
`--shadow` 柔和阴影（v0.1 阶段 3 token）。

### 5.3 空态 / 统计 chip

- 空态统一 EmptyHint：`text-[12px] text-secondary-text`，一句话说明 + 触发时机；
- stat chip：`text-[11px] px-2.5 py-1 rounded-full bg-muted/70`，数字 `font-bold`
  （如「未来 7 天前瞻 **8**」「⭐ 重点关注 **2**」）。

---

## 六、市场聚焦页专项规范（参照实现，已实施）

### 6.1 内容矩阵（3 聚焦 × 3 tab）

| | 🔥 事件 | 📊 板块 | ⭐ 个股 |
|---|---|---|---|
| 🎯 明日重点 | 明日财经日历 | 今日发酵回溯（池明细行业 Top4） | 今日梯队回溯（连板高度 Top5） |
| 📅 周聚焦 | 未来 7 天日历前瞻 + 近 7 天回顾（置底） | 上周期回溯聚合 | 上周期回溯聚合 |
| 🌙 月聚焦 | 本月重点日程 + 上月回顾（置底） | 上月整月涨幅榜 | 上月最高连板榜 |

周期语义（后端契约，UI 文案须一致）：

- **明日重点**：每日收盘采集后生成，次日重生成；
- **周聚焦**：**未来 7 天滚动窗口**（[今日, 今日+6]），每日采集刷新；
  前瞻固定为财经日历（无未来新闻可预知），回顾取近 7 天快讯 Top5；
- **月聚焦**：本月首个采集日生成一次，整月固定；
- 板块/个股均为上一周期回溯聚合（未来数据不存在，只能回溯）。

### 6.2 页面组件清单

- **周期头 + stat 行**：`text-[15px] font-bold` 标题 + 日期 + 生成语义徽章
  （「未来 7 天滚动 · 每日采集刷新」/「本月首个采集日生成 · 整月固定」/「每日收盘采集后生成」）+ stat chip 行；
- **事件卡**：按 §4.1；meta 行 = 时间粗体 primary + 地区 chip + 影响级 chip，标题独立成行；
- **外国事件时间显示**：日历源时间已确认为北京时间，展示为
  `20:30 北京（美东 08:30）`——`REGION_TZ` 地区→IANA 时区映射 +
  `Intl.DateTimeFormat` 换算（DST 安全），中国/香港地区只显示本地时间；
- **日期分组带**：按 §4.4；周聚焦每天一组，空档渲染虚线占位；
- **周聚焦日期导航**：`全部 / 今天 / 周一~周六` 筛选 pill（§5.1 小号规格），
  选中某天只渲染该天分组，回顾区不受筛选影响；
- **回顾区固定置底**：日期分组之后，`🕘 近 7 天回顾（延续关注）` 分组头
  （弱化版分组带：透明底 + 虚线右延）+ 事件卡列表；
- **板块 rank 卡**：RankBadge + 名称 + 龙头 chip（`bg-primary/10 text-primary`）+
  lifecycle meta + 逐日涨停趋势条（`h-6 w-2.5` 迷你柱）+ 右侧大号涨跌幅；
- **个股 rank 卡**：连板徽章 + code（tabular-nums）+ 名称 + label 徽章 +
  concept meta，reason 独立成行 secondary。

---

## 七、落地阶段（每阶段独立可发布、独立回滚）

| 阶段 | 内容 | 改动面 | 状态 |
|---|---|---|---|
| 0 | 删除 `html { font-size: 14px }` 全局缩放 | 1 行 | **已实施**（待双主题走查） |
| 1 | v0.1 沿用：默认浅色主题 + 浅色 token 微调（背景 #f0f4f9、边框 #e2e8f0、阴影 token、primary-dark） | 2 文件 | **已实施**（阴影复用既有 `--shadow-soft-card`；`--primary-dark` 取值待走查确认） |
| 2 | v0.1 沿用：侧边栏实体图标（emoji + aria-hidden，页面内功能图标保留 lucide） | 1 组件 | **已实施** |
| 3 | 市场聚焦页修缮（§四~§六 首发验证字阶/强调系统） | 1 组件段 | **已实施** |
| 4 | 全站清扫：grep 清除 ≤10.5px 字号 + 层级走查（约 20 文件），涨跌色统一切 `--color-up/down` | 分批 PR | 批次一（字号清扫，22 文件 108 处）**已实施**；涨跌色切 `--color-up/down` 待实施 |

v0.1 其余结论继续有效：辅助文字对比度加深至 ≈4.6:1（§4.2）、品牌区使用
`logo-mark.svg`（§4.4）、桌面端自动继承（§4.5）。

## 八、验证与交付要求（仓库硬规则）

- Web 改动：`cd apps/dsa-web && npm run lint && npm run build`；
- 阶段 0 为全局变更，合入前全页面走查（浅色 + 深色双主题），重点检查
  表格/弹窗/侧边栏是否出现溢出；
- 按 AGENTS.md，PR 描述必须附受影响页面前后对比截图（截图入 PR 描述，不入仓库）；
- 建议每阶段附一张固定页面（大盘情绪）作为密度回归基准。

## 九、风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 阶段 0 全局放大 | 个别紧凑布局溢出 | 全页走查 + 微调；1 行 revert 即回滚 |
| 字面 px 类迁移量大（阶段 4） | 分批不一致 | 病例页（阶段 3）已固化规范，再批量迁移 |
| 深色模式对比度 | 新样式看不清 | 硬规则：双主题走查 + `-400/xx` 别名色 |
| 老用户视觉突变 | 即本次目的 | ThemeToggle 可切回浅色偏好；字号变大不属于偏好回滚范围 |

**回滚方式**：各阶段独立 commit，`git revert` 对应提交；无数据/接口变更。
