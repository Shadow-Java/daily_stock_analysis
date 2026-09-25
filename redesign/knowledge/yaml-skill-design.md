# 本项目 YAML 的核心用途：把"交易策略"变成零代码配置

> 仓库里的 YAML 主要就一类：`strategies/` 下 15 个**策略技能文件**（dragon_head 龙头策略、wave_theory 波浪理论、chan_theory 缠论、emotion_cycle 情绪周期等）。另外还有 `litellm_config.example.yaml`（LLM 网关配置）和 `docker-compose.yml`，但核心是策略 YAML。

## 它做什么

每个 YAML = 一份给 AI 看的"分析作业指导书"：

```yaml
name: dragon_head              # 唯一标识（激活/路由用）
display_name: 龙头策略           # 用户看到的名字
description: 板块轮动中识别龙头股  # 什么时候用
required_tools:                 # 分析时需要哪些数据工具
  - get_realtime_quote
  - get_sector_rankings
aliases: [龙头, 龙头战法]        # 用户说"龙头"也能匹配到
instructions: |                 # ← 核心：自然语言的评估标准
  1. 板块领涨地位：用 get_sector_rankings 检查…
  2. 换手率与动能：龙头股通常 > 5%…
  评分调整：确认为龙头股：sentiment_score +10
```

运行时被 `SkillManager` 加载（`src/agent/skills/base.py:315`）→ 拼进 system prompt → LLM 按这些规则调工具、按这个评分标准输出结论。

完整流程：

```
① strategies/dragon_head.yaml          ← 用户写自然语言，零 Python 代码
        ▼
② load_skill_from_yaml()               base.py:140  yaml.safe_load → Skill dataclass
        ▼
③ SkillManager                         base.py:315  加载内置 + 自定义，activate() 按名激活
        ▼
④ get_skill_instructions()             base.py:433  按 category 分组渲染成 Markdown 文本
        ▼
⑤ factory.py:541                       塞进 PromptState.skill_instructions
        ▼
⑥ executor.py:552                      "## 激活的交易技能" → format 进 system prompt 模板
        ▼
⑦ system prompt → ReAct 循环 → LLM     模型按 instructions 调用 required_tools 声明的工具
```

关键设计点：

1. **YAML 里写的就是"AI 语言"**——`instructions` 字段直接是自然语言策略文本，没有中间 DSL，翻译过程只是**拼接和分组**，不改写语义
2. **元数据驱动调度**：`aliases`（口语匹配）、`market_regimes`（行情状态路由）、`required_tools`（告知需要哪些工具）、`core_rules`（关联交易铁律编号）——这些不给 LLM，给 SkillRouter/Scheduler 做多策略编排
3. **Markdown bundle 也支持**：`load_skill_from_markdown` 解析 SKILL.md 的 frontmatter（YAML 头部）+ 正文

## 对用户有什么用

1. **不加代码就能"教"AI 新策略**：用户建一个 `my_strategy.yaml` 放进自定义目录，AI 立刻会按这个策略分析股票——不需要懂 Python，不需要发版
2. **按需组合**：`activate(["dragon_head", "wave_theory"])` 想用哪几个开哪几个，多策略经过 Scheduler/Aggregator 聚合成综合结论
3. **口语可调用**：聊天里说"用龙头战法看看 600519"，`aliases` 负责匹配
4. **可分享**：YAML 文件即策略，复制一个文件就分享了一套打法

## 为什么需要（不用 YAML 行不行）

根本原因：**策略是高频变化的业务知识，LLM 的行为靠 prompt 驱动**。

| 如果写死在 Python 里 | 用 YAML 配置 |
|---|---|
| 每加一个策略要开发、测试、发版 | 用户自己写文件即可 |
| 修改措辞/评分标准要改代码 | 改文本就行 |
| 策略无法在用户间流通 | 文件即策略，天然可分享 |
| prompt 散落各处难维护 | 结构化字段（aliases/tools/路由规则）+ 自然语言正文分离，机器读元数据，LLM 读正文 |

一句话：**YAML 是用户和 AI 之间的"策略合同"——人用它能写清楚打法，机器能解析调度，LLM 能照着执行**。这正是 redesign 文档强调"零代码技能系统"的原因：新增策略的成本被压到了"写一个文本文件"。
