# UI 风格重构 — 浅色默认 + 实体图标 + 对齐设计稿

> 版本: v0.1 草稿 | 日期: 2026-09-25 | 状态: 待评审
> 目标：以 `redesign/design/ui-mockup.html` 为唯一视觉基准，调整 Web 端（`apps/dsa-web/`）整体风格。
> 设计稿：[../design/ui-mockup.html](../../design/ui-mockup.html)

---

## 一、结论先行

**好消息：现有设计 token 基础与设计稿高度一致**，主色、圆角、字体族完全相同，不需要"换皮"，只需要三处定向修改：

| # | 诉求 | 差距 | 改动量 |
|---|------|------|--------|
| 1 | 默认浅色主题 | `ThemeProvider.tsx:12` 写死 `defaultTheme="dark"` | 1 行 |
| 2 | 菜单栏实体图标 | 当前用 lucide 线性描边图标，设计稿用实体（emoji）图标 | 1 个组件 |
| 3 | 整体风格对齐设计稿 | 背景色、卡片阴影、导航激活态、按钮渐变存在细微差异 | 若干 CSS token |

---

## 二、现状 vs 设计稿对比

| 设计要素 | 设计稿 ui-mockup | 现状 apps/dsa-web | 是否需改 |
|---|---|---|---|
| 主色 | `#00b8d9` | `--primary: 193 100% 43%` = `#00b8d9` | ✅ 已一致 |
| 圆角 | `10px / 6px` | `--radius: 0.625rem` = 10px | ✅ 已一致 |
| 字体 | SF Pro / Inter | Inter / SF Pro Display | ✅ 已一致 |
| 页面背景 | `#f0f4f9`（浅蓝灰） | `216 33% 97%`（更浅，偏白） | 微调 |
| 卡片 | 白底 + 边框 `#e2e8f0` + **柔和阴影** | 白底 + 边框，**几乎无阴影** | 需加阴影 token |
| 侧边栏 | 白底 140px，激活态 `#e6f9fc` 底 + `#007fa3` 深青文字 | 白底 136px，激活态 primary/9% 透明底 | 微调 |
| 主按钮 | 青色**渐变** `135deg #00b8d9→#0090b0` | 纯色 primary | 加渐变 token |
| 菜单图标 | 实体 emoji：🎯 🌱 🧾 🌡 | lucide 线性描边：Target Thermometer … | 需替换 |
| 默认主题 | 浅色（设计稿只有浅色） | **深色** | 需改默认值 |
| 导航激活文字色 | 深青 `#007fa3`（对比度更高） | 原色 `#00b8d9` | 建议加深 |

---

## 三、修改方案（按阶段）

### 阶段 1：默认浅色主题（P0，1 行 + token 微调）

**文件：`apps/dsa-web/src/components/theme/ThemeProvider.tsx`**

```tsx
// 改动前
defaultTheme="dark"
// 改动后
defaultTheme="light"
```

语义说明：
- `next-themes` 的行为：**已手动切换过主题的用户**（localStorage 有记录）不受影响；从未切换过的用户从深色变为浅色 —— 这正是本次目的。
- `enableSystem` 与 `ThemeToggle` 保留，暗色主题作为**可选项**继续维护，不删除 `.dark` token 段。

**文件：`apps/dsa-web/src/index.css`（仅 `:root` 浅色段，不动 `.dark`）**

```css
/* 页面背景对齐设计稿 #f0f4f9 */
--background: 216 33% 97%;   /* 改前 */
--background: 216 44% 96%;   /* 改后 = #f0f4f9 */

/* 边框对齐设计稿 #e2e8f0（更柔和） */
--border: 217 28% 84%;       /* 改前 */
--border: 214 32% 91%;       /* 改后 = #e2e8f0 */

/* 新增：设计稿的柔和阴影（卡片立体感的关键） */
--shadow: 0 1px 4px rgb(0 0 0 / 0.08), 0 2px 12px rgb(0 0 0 / 0.04);
--shadow-md: 0 4px 16px rgb(0 0 0 / 0.10);

/* 新增：激活态深青，对比度优于原色 */
--primary-dark: 194 100% 32%;  /* = #007fa3 */
```

### 阶段 2：侧边栏实体图标（P0，1 个组件）

**文件：`apps/dsa-web/src/components/layout/SidebarNav.tsx`**

`NavItem.icon` 从 `React.ComponentType` 改为 emoji 字符串，渲染 `<span>` 替代 `<Icon />`：

| 菜单 | 现图标（lucide） | 实体图标（提案） |
|---|---|---|
| 首页 | Home | 🏠 |
| Chat | MessageSquareQuote | 💬 |
| 选股 | Search | 🔍 |
| 持仓 | BriefcaseBusiness | 💼 |
| 决策信号 | Activity | ⚡ |
| 大盘情绪 | Thermometer | 🌡 |
| 预期 | Target | 🎯 |
| 回测 | BarChart3 | 📊 |
| 告警 | Bell | 🔔 |
| 用量 | Gauge | ⛽ |
| 设置 | Settings2 | ⚙️ |
| 主题切换 | Sun/Moon | ☀️ / 🌙 |
| 语言切换 | Languages | 🌐 |
| 退出 | LogOut | 🚪 |
| 品牌区 | 纯文字渐变 | 渐变方块 + 📊（见设计稿 `.brand-icon`） |

实现要点：
- emoji 宽度统一：`<span className="w-[18px] text-center text-[15px] leading-none">`，与设计稿 `.nav-item .icon` 一致；
- `NavLink` 已有 `aria-label={label}`，emoji 加 `aria-hidden` 防止读屏重复朗读；
- **页面内部的功能图标保留 lucide**（表格操作、表单控件等），不做全站 emoji 化 —— 设计稿本身也是"导航实体、内容中性"的分工。

**备选方案**（若觉得 emoji 在 Windows 上渲染不统一）：
- Phosphor Icons（`weight="fill"`）或 Material Symbols Rounded（fill 变体），单色填充风格、跨平台一致，代价是新增一个依赖。
- 默认推荐 emoji：与设计稿完全一致、零依赖、彩色更"实体"。

### 阶段 3：全局细节对齐（P1，纯 CSS token）

| 细节 | 改法 | 文件 |
|---|---|---|
| 卡片阴影 | `--card` 组件统一追加 `box-shadow: var(--shadow)` | `index.css` |
| 主按钮渐变 | 新增 `--btn-primary-bg: linear-gradient(135deg,#00b8d9,#0090b0)` | `index.css` |
| 导航激活文字 | `text-[hsl(var(--primary))]` → `text-[hsl(var(--primary-dark))]` | `SidebarNav.tsx:92` |
| 侧边栏宽度 | `w-[136px]` → `w-[140px]`（可改可不改） | `Shell.tsx:63` |
| 悬停反馈 | 列表/卡片 hover 从变色升级为 `var(--shadow-md)`（设计稿 `.exp-card:hover`） | `index.css` |

---

## 四、优化建议（超出诉求，供决策）

### 4.1 ✅ 涨跌颜色语义（已拍板：统一配置，默认红涨绿跌）

设计稿是西方惯例 **绿涨红跌**（`.up { color: var(--green) }`）。
当前代码里 `--color-success`（绿）/ `--color-danger`（红）混合承担了"状态"和"涨跌"两种语义。

**决策（2026-09-25）**：新增统一的 UI 配置 token `--color-up` / `--color-down`，**默认红涨绿跌**（A股惯例），且支持通过配置调整；涨跌展示全部改引这两个 token，与 success/danger（成功/失败状态）解耦。设计稿中的绿涨红跌示例仅作视觉参考，落地按本决策执行。

实施要求：
- token 定义集中在 `index.css`（浅色/深色各一份），组件只引用语义名，不写死颜色；
- 页面内所有涨跌展示（行情、K线、持仓盈亏、涨跌幅 badge 等）统一切换到这两个 token，避免部分页面残留旧色。

### 4.2 辅助文字对比度（可访问性）

设计稿三级文字 `--text3: #8896aa` 在白底上对比度约 2.9:1，不满足 WCAG AA（4.5:1）。
**建议**：浅色主题下加深到 `#5f7086` 级别（≈4.6:1），影响 `--muted-text` / `--muted-foreground` 两个 token。

### 4.3 密度分级

设计稿基准 13px，明显比现有紧凑。全站直接降字号风险大，**建议分级**：
- 数据密集区（表格、列表、stat-chip）：降到 12.5–13px，行高收紧；
- 阅读区（报告正文、Chat）：保持现状。

### 4.4 品牌区升级

现状是纯文字 "YueJie" 渐变字。设计稿是 `34px 渐变圆角方块 + 品牌名`。
`redesign/design/assets/logo-mark.svg` 已有现成 logo，建议品牌区直接用它，替代 emoji 📊。

### 4.5 桌面端

`apps/dsa-desktop/` 加载的是 Web 构建产物，以上改动**自动继承**，无需单独开发；仅需发版前回归一次桌面端启动链路。

### 4.6 验证与交付要求（仓库硬规则）

- Web 改动：`cd apps/dsa-web && npm ci && npm run lint && npm run build`；
- 按 AGENTS.md，PR 描述必须附**受影响页面前后对比截图**（首页、大盘情绪、预期列表三个代表页）；
- 截图放 PR 描述/评论，不入仓库。

---

## 五、实施顺序与状态

| 阶段 | 内容 | 改动面 | 状态 |
|---|---|---|---|
| 1 | 默认浅色 + 浅色 token 微调 | 2 文件 | 待评审 |
| 2 | 侧边栏实体图标 | 1 组件 | 待评审 |
| 3 | 卡片阴影/按钮渐变/激活色/密度 | CSS token 为主 | 待评审 |
| 4（建议项） | 涨跌色语义（✅已拍板：统一 token，默认红涨绿跌）、对比度、品牌区 | token + 若干组件 | 涨跌色已定，其余待拍板 |

每阶段独立可发布、独立可回滚（见下）。

## 六、风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 老用户从深色变浅色 | 视觉突变（即本次目的） | ThemeToggle 一键切回；localStorage 已有偏好的用户不受影响 |
| emoji 跨平台渲染差异 | Windows/macOS 图标风格略不同 | 备选方案 B（Phosphor fill）；实体感本身就是设计目标 |
| 浅色 token 微调引发局部对比度问题 | 个别组件在浅色下看不清 | 阶段 1 后全页面走查；`.dark` 段不动，回滚只需还原 token |
| 图标组件签名变化 | 引用 `NavItem.icon` 类型的测试失败 | 更新 `SidebarNav` 的 `__tests__` 快照 |

**回滚方式**：三个阶段均为独立 commit，`git revert` 对应提交即可；无数据/接口变更。
