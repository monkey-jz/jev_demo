# Jev（System One）内部分享：概念、对比、接入与实测

> **分享日期**：2026-11-01  
> **适合听众**：研发、产品、算法、对 AI 能力选型感兴趣的同事  
> **材料来源**：《TypeSafe / Jev 官方 Skill 安装与使用教程》PDF（25 页，2026-10-25 核对）第 1–9 节 + TypeSafe 官网 `typesafe.ai` 与官方文档 `docs.typesafe.ai`（2026-11-01 抓取）+ 首次实测 14 次真实 API 调用（12 次成功判断请求）+ 2026-11-01 复跑验证 10 次调用（9 次判断 + 1 次模型查询，均 HTTP 200）  
> **口径说明**：概念、问题类型、错误码、Skill 安装步骤取自官方教程；官方定位与性能/价格数字取自官网，均标注为厂商口径；与生成式 LLM 的横向对比、实测数据为本材料补充，非官方结论。  
> **实测环境**：macOS (Darwin 24.6.0)、curl 8.7.1、模型 `jev-1.14.0`
>
> **⚠️ 敏感信息**：§3.2 含本次实测使用的真实 API Key，仅限内部受控分享。Key 可发起付费调用；对外发送、上传网盘或仓库前，请删除该 Key 并在 TypeSafe 控制台轮换。

---

## 3 分钟速览

- **Jev 不是聊天模型，而是判断模型**：你提供证据（state）和问题（questions），它在**你给定的封闭选项/等级**上返回概率。
- **官方定位**：Jev 是 TypeSafe 的旗舰模型、首个 **System One 模型**，为软件内部决策而生（官网：machine-native intelligence infrastructure）。官方称新架构 + 并行采样 + **RLCD** 训练；官网宣称在 System One 任务上比 LLM 快 193.6×、便宜 444.6×（厂商口径，本材料未独立验证）。
- **三种题型**：`choice`（选一个）、`noul`（是/否的概率）、`score`（有序程度打分）。
- **一次请求可并行问多个独立问题**，返回固定结构的 JSON，程序直接读取，不需要解析自然语言。
- **与 GPT / Claude / DeepSeek 是分工而非替代**：Jev 负责高频、结构化、可审计的判断；生成式 LLM 负责生成、推理、对话和执行工具。
- **接入成本极低**：一次 curl 即可；本次已跑通工单分流、工具路由、搜索排序、内容审核、信息提取、商品去重等 6 个场景。
- **Skill 是可选的**：直接 curl 不需要安装任何 SDK；Skill 只是给编程助手的接入指南（教程 §2–4）。
- **主要注意点**：curl 不读 macOS 系统代理（直连会遇 451 地区限制）；问题设计要把事实放 state；置信度 ≠ 准确率，阈值需用自有样本校准。

---

## 目录

1. 概念：Jev 是什么
2. 对比：Jev 与主流生成式 LLM 的区别
3. 环境配置
4. 使用方法与问题设计
5. 实测示例（本次真实请求）
6. 落地建议
7. 附录：快速复现脚本、名词表、参考资料

---

# 1. 概念：Jev 是什么

## 1.0 官方定位：官网怎么说（typesafe.ai / docs.typesafe.ai）

> 以下内容整理自 TypeSafe 官网首页、官方文档与官方博客（2026-11-01 抓取）。营销性数字均为**官方口径**，本材料未独立复现。

**一句话定位**：TypeSafe AI 是一家 AI lab，构建面向自动化的 machine-native intelligence infrastructure；Jev 是它的旗舰模型，也是第一个 **System One 模型**——为软件直接使用而生的快速、结构化决策模型。

**「不是聊天」的研究方向**：官网首页明确写 "We took the opposite research direction: not chat."。官方认为 RLHF 让人工偏好主导，带来 mode dropping、overconfidence、lack of reliability，因此 chat 模型始终需要 human-in-the-loop。

**技术主张**：

- 新模型架构 + 并行采样器（parallel sampler）+ 新训练算法 **RLCD（Reinforcement Learning for Calibrated Decisions）**
- **Decisions, not strings**：输出是程序可直接使用的 typed values，而不是文本
- **More like code**：可靠、快、type-safe；每个决定带校准后的 confidence
- 官方比喻：**frontier-intelligence function call**——unstructured state in, typed probabilistic decisions out

**官方性能 / 价格口径**（标签：官方说法，未独立验证）：

| 官方说法 | 出处 |
|---|---|
| System One 任务上比 LLM 快 **193.6×**、便宜 **444.6×** | 官网首页 |
| 示例：Jev `$0.000081` / `0.114s` vs LLM `$0.013880` / `8.566s` | 官网首页 |
| 输入 **$42 / 十亿 tokens**；输出免费（too cheap to meter） | 官网首页、官方博客 |
| 输入价格比 Claude Fable 5.1 低 **238×** | 官网首页 |
| 端到端 **70–500ms**；同等工作负载比 frontier LLM 快 **40×–200×** | 官方博客 |
| 「Zero Hallucinations」 | 官网首页 |

**如何正确理解这些数字**：

- 以上是**厂商口径**。官方博客自己写道：速度评测通常从西海岸的笔记本发起，服务目前也在西海岸；并提醒「Don't believe it entirely. Always favor your own experimentation and evals with your use cases.」
- **「零幻觉」有边界**：官方指不生成自由文本、不会输出类型/选项之外的值；**判断本身仍可能出错**（官网 FAQ 同样列出 "Can Jev still get things wrong?"）。不要等同于「判断永远正确」。
- 官方承认无法证明价格不是补贴；价格以控制台账单和最新报价为准。
- 本次经本地代理实测的完整 HTTP 往返约 **0.84–1.30s**，与官方 0.114s / 70–500ms 的测量条件不同，不可直接对比。

**官方文档还强调**：

- 三种问题类型是 **AI primitives**：模块化、可组合、结构化、可靠、快速。
- 所有问题在同一 `state` 上**并行、隔离**评估；增加问题几乎不改变响应时间，也不会产生 context rot。
- 问题应**原子化**：每个问题只做一个具体判断；多维判断拆成多个问题，再用代码组合权重。

## 1.1 名词表（教程 §1.1）

| 名词 | 含义 |
|---|---|
| **TypeSafe** | 提供 System One 模型和 API 的平台 |
| **Jev** | System One 模型本体：根据你提供的内容做**分类、评分、真假判断** |
| **API Key** | 调用 TypeSafe API 的认证凭据 |
| **Skill** | 给编程助手（Claude Code / Codex）的接入指南与工作流，可选 |
| **state** | 待分析的证据：字符串、JSON 对象或数组 |
| **questions** | 需要模型回答的问题集合，每个问题有一个供程序读取结果的 ID |

一句话：**TypeSafe 是平台，Jev 是模型，state/questions 是你和模型之间的契约。**

## 1.2 核心心智模型：把「写答案」换成「做判断」

生成式 LLM 的交互方式是：

> 给一段提示词 → 模型**生成**一段自由文本 → 你解析文本、猜测它的意思。

Jev 的交互方式是：

> 给一段证据 + 一组封闭问题 → 模型在**你定义好的选项空间**里返回概率/分数。

```text
生成式 LLM：  提示词 ──▶ 自由文本（需要解析、可能跑偏）
Jev：         证据 + 问题 + 选项/等级 ──▶ 结构化概率（直接读取）
```

用统计的话说：**你定义假设空间，Jev 返回这个空间上的后验分布。** 这让结果天然便于程序消费，也便于审计和设阈值。

## 1.3 三种问题类型（教程 §1.2）

| 类型 | 你需要提供 | 返回值 | 典型用途 |
|---|---|---|---|
| `choice` | `criteria`：`{选项ID: 描述}` 对象 | `choice`（选中的 ID）、`probabilities`、`confidence` | 选部门、选工具、选情绪类别、选候选值 |
| `noul` | `instructions`；可选 `criteria: {true, false}` 定义判断口径 | `noul`：回答「是」的概率（0～1） | 是否广告、是否业务中断、是否包含某信息 |
| `score` | `criteria`：从低到高排列的等级数组 | `score`（概率加权、可为小数）、`legend`、`probabilities`、`confidence` | 紧急度、相关度、违规严重度、匹配度 |

要点：

- **Choice 一次选一个。** 多个标签可以同时成立时（如「既是广告又是辱骂」），应拆成多个 Noul 问题。
- **Noul 的 0.5 表示不确定，不是「中等程度」。** 它没有单独的 `confidence` 字段。
- **Score 的等级从 0 开始编号**：3 个等级对应 0～2，4 个等级对应 0～3。返回的 `score` 是概率加权的等级位置，**可以是小数**（实测出现过 2.60、1.96）。
- **`criteria` 只是标签定义，不是提示词技巧。** 描述越贴近业务口径，越能减少歧义。

## 1.4 一次请求，多个独立问题（教程 §1.3）

同一个 `state` 上可以同时问多个问题，它们**并行判断、彼此看不到对方的答案**。这适合多信号决策，例如一张工单同时判断：

- 该去哪个部门（choice）
- 有多紧急（score）
- 客户情绪（choice）
- 业务是否中断（noul）

注意：

- 若后一个问题需要依赖前一个问题的答案，**不能在同一个请求里串起来**；应在问题上显式写出前提，或拆成两次请求。
- 问题越多，token 用量越高；但多个独立信号合并到一次请求，通常比拆成多次更省。

## 1.5 响应结构与结果读取（教程 §6.3）

以工单分流为例，响应形态如下：

```json
{
  "model": "jev-1.14.0",
  "answers": {
    "department": {
      "type": "choice",
      "choice": "technical",
      "confidence": 1.0,
      "probabilities": { "technical": 1.0, "billing": 0.0, "sales": 0.0, "other": 0.0 }
    },
    "urgency": {
      "type": "score",
      "score": 2.0,
      "confidence": 1.0,
      "legend": {
        "0": "无时间要求，可以等待常规处理",
        "1": "希望尽快处理，但未报告业务中断",
        "2": "业务已中断，或明确要求立即处理"
      },
      "probabilities": { "0": 0.0, "1": 0.0, "2": 1.0 }
    },
    "tone": {
      "type": "choice",
      "choice": "frustrated",
      "confidence": 0.97,
      "probabilities": { "calm": 0.0, "frustrated": 0.98, "angry": 0.02 }
    },
    "business_blocked": { "type": "noul", "noul": 0.96 }
  },
  "usage": { "input_tokens": 677, "output_tokens": 120 }
}
```

读取路径：

| 字段 | 含义 |
|---|---|
| `model` | 本次实际处理的模型版本 |
| `answers.<id>.choice` | Choice 选中的选项 ID |
| `answers.<id>.probabilities` | 所有选项的概率分布 |
| `answers.<id>.confidence` | 答案分布的确定程度 |
| `answers.<id>.score` | Score 的加权等级位置（可为小数） |
| `answers.<id>.legend` | 等级编号 → 描述 |
| `answers.<id>.noul` | 「是」的概率 |
| `usage.input_tokens` / `output_tokens` | token 用量 |

**关于 confidence 的重要提醒**：

- `confidence` 反映模型对答案分布的确定程度，**不是业务正确率**，也不能当作自动执行的授权。
- 它和 Score 的数值是两个独立信号。实测中见过「分数 2.60、confidence 只有 0.62」和「分数 0.01、confidence 1.0」的情况：前者高分但犹豫，后者低分但笃定。
- 需要保留原始概率；阈值、路由、排序等业务规则应放在程序里，用自有样本校准。

---

# 2. 对比：Jev 与主流生成式 LLM 的区别

## 2.1 本质差异：生成 vs 判断

GPT、Claude、DeepSeek 等主流模型是**生成式**：它们的目标是产生自然语言（或代码、工具调用）。Jev 是**判断式**：它的目标是回答你已经定义好的封闭问题。

这不是「谁更强」的问题，而是**输出形态和职责不同**：

- 让生成式模型做分类，你要靠提示词约束格式，再解析、校验、兜底；
- 用 Jev 做分类，你得到的就是概率分布，模型不可能「自由发挥」出一个你没有提供的选项。

## 2.2 对比表

| 维度 | Jev（System One） | GPT / Claude / DeepSeek 等生成式 LLM |
|---|---|---|
| 核心任务 | 分类、评分、真假判断 | 生成文本、代码、推理、对话 |
| 训练目标（官方对比口径） | **RLCD**：为「校准决策」优化 | **RLHF / RLVR**：人类偏好 / 可验证奖励 |
| 采样方式（官方对比口径） | **并行采样**，一次查询输出所有答案 | **自回归**，逐 token 生成 |
| 输入 | `state`（字符串 / JSON 对象 / 数组）+ `questions` | `messages` 多轮对话，部分支持图片/文件 |
| 输出 | 固定结构：`choice` / `score` / `noul` + 概率 | 自由文本、结构化输出或工具调用 |
| 输出空间 | 由你的 `criteria` **封闭** | **开放**，需要提示词与解析器约束 |
| 多问题 | 一次请求并行、彼此独立 | 一次一个回复；多轮靠客户端拼历史 |
| 状态 | 无状态，每次请求独立 | API 无状态，多轮靠传历史 |
| 置信度 | 原生 `probabilities` / `confidence` | 无原生业务置信度；logprobs 不等同 |
| 执行动作 | **不执行**，只返回判断 | 可通过 function calling 执行工具 |
| 多语言 | 中文可用；官方主训练英文，建议自测 | 多语言覆盖更广 |
| 结果可审计 | 字段稳定、概率保留，便于日志与阈值化 | 需额外结构化约束与校验 |

> 实测延迟与成本（仅本次小样本，不代表生产）：单个判断请求经本地代理的完整往返约 **0.84 / 1.30 / 0.90 秒**（含建连与代理开销）；Playground 示例显示服务端耗时 **75ms + 266ms**。判断请求输出 token 很少（本次 21～120），成本按账号实际计费为准。

> 说明：本节对比基于教程对 Jev 的定位与生成式 LLM 的公开能力，属于本材料的工程视角，不是官方发布的基准评测。  
> 官方对比材料：官网首页称 193.6× faster / 444.6× cheaper（System One 任务）；官方博客称 70–500ms、比 frontier LLM 快 40–200×。官方侧对侧演示使用 GPT-5.6 Terra，价格对比使用 Claude Fable 5.1；均为厂商口径。

## 2.3 什么时候用谁

**优先考虑 Jev：**

- 高频、规则相对清晰、需要**稳定结构化输出**的语义判断
- 需要**概率/置信度**来做阈值、复核、排序的任务
- 分类目标可以被**封闭枚举**（部门、工具、意图、候选值、等级）
- 希望把判断结果写进日志、做 A/B、做人工复核的业务
- 典型场景：工单路由、内容审核、意图→工具、候选排序、字段提取、实体去重

**优先考虑生成式 LLM：**

- 写回复、总结、翻译、解释、头脑风暴
- 开放域问答、多步推理、代码生成
- 需要多轮对话记忆、需要调用外部工具的自主 Agent
- 输入包含图片、音频等多模态内容（Jev 文档面向文本/结构化内容）
- 判断标准本身还不稳定、需要先探索再固化的任务

## 2.4 组合使用：LLM 做生成，Jev 做闸门

两者不是二选一。一个常见的生产架构：

```text
用户消息
   │
   ▼
┌─────────────────────┐
│  Jev：路由/分级/审核  │  一次请求拿到：部门、紧急度、风险标签
└─────────┬───────────┘
          │
   ┌──────┴────────┐
   ▼               ▼
低风险/标准化      高风险/复杂
自动处理           ↓
                 ┌───────────────┐
                 │ LLM：生成/推理  │  草稿、解释、长文本
                 └───────┬───────┘
                         ▼
                 ┌───────────────┐
                 │ Jev：输出复核   │  是否越界、违规、承诺赔付
                 └───────────────┘
```

这类「Jev 闸门 + LLM 生成 + Jev 复核」的模式，能同时拿到结构化、可审计的分级能力和开放生成能力，也便于控制成本与风险。

## 2.5 Jev 的边界（不要期待它做什么）

- **不生成自然语言答案**：不要指望它写回复、做总结。
- **「零幻觉」不等于判断永远正确**：官方所说的 no hallucination 指不生成自由文本、不会输出未定义的类型/选项；选项和等级仍由你定义，判断错误仍可能发生（官网 FAQ 有 "Can Jev still get things wrong?"）。
- **不维护多轮记忆**：每次请求独立，上下文要你自己放进 `state`。
- **不执行工具或业务动作**：不查日历、不退款、不合并数据；这些由程序根据判断结果执行。
- **不保证输出你未提供的选项**：候选漏了就是漏了，程序要负责修正候选生成过程。
- **不是准确率承诺**：官方教程也明确建议用自有代表样本评估；本材料同样不做准确率背书。

---

# 3. 环境配置

## 3.1 准备清单

| 准备项 | 何时需要 | 要求 |
|---|---|---|
| curl | 直接调用 HTTP API | 本文使用 `--fail-with-body`，需 **curl ≥ 7.76**（本机 8.7.1） |
| TypeSafe API Key | 查询模型、发起判断 | 在 TypeSafe 控制台创建 |
| 合规网络出口 | 访问 api.typesafe.ai | 部分网络/地区直连会返回 451，见 3.3 |
| jq | 命令行筛选字段 | 可选，不影响调用 |
| Node.js ≥ 22.20 | 仅安装 Skill 时需要 | 直接调 API 不需要 |
| Git | 手动克隆 Skill 仓库 | 仅安装 Skill 时需要 |
| 官方文档 / 控制台 | 查阅文档、创建 Key | https://docs.typesafe.ai/introduction · https://console.typesafe.ai/ |

## 3.2 配置 API Key

**本次分享内置 Key（真实值，仅限内部现场复跑）**：

```bash
export TYPESAFE_API_KEY="apikey_21467fa6ed796ec14e9693bea7e849adebfe_a4562de37eb9ec2953f025e2ce2724acb84fb77e8a46f01f93bf54188f412873"
```

> 任何拿到本文档的人都能用这个 Key 发起调用并产生费用。仅限内部受控范围；分享结束或对外发送前，删除本块并在 TypeSafe 控制台轮换。日常开发仍建议使用下面的环境变量或钥匙串方式。

macOS / Linux（本机使用 `~/.bash_profile`）：

```bash
# 写入当前用户的 shell 配置
echo 'export TYPESAFE_API_KEY="<你的 API Key>"' >> ~/.bash_profile

# 含密钥的配置文件收紧为仅本人可读写
chmod 600 ~/.bash_profile

# 当前终端立即生效
source ~/.bash_profile

# 验证：只打印长度，不打印明文
test -n "$TYPESAFE_API_KEY" && echo "已设置，长度 ${#TYPESAFE_API_KEY}"
```

注意生效范围：

| 场景 | 是否生效 |
|---|---|
| 新开的终端窗口 | ✅（macOS 终端默认登录 shell） |
| 已打开的终端 | ❌ 需 `source ~/.bash_profile` |
| 已运行的进程/应用 | ❌ 环境变量只在启动时读取 |
| 从 Dock 启动的 GUI 应用（如 PyCharm） | ❌ 需在该应用自己的环境设置中配置 |

安全建议：

- API Key **只放服务端**，不要写进前端代码或提交到 Git 仓库。本文档为了内部现场复跑内置了真实 Key（§3.2），属于临时例外；**对外分享前必须删除该块并轮换**。
- 不想在配置文件里放明文，可用 macOS 钥匙串：

```bash
security add-generic-password -a "$USER" -s TYPESAFE_API_KEY -w '<你的 API Key>'
# .bash_profile 中改为：
export TYPESAFE_API_KEY="$(security find-generic-password -a "$USER" -s TYPESAFE_API_KEY -w)"
```

## 3.3 网络与代理（本次踩过的坑）

**现象**：直连 `https://api.typesafe.ai` 返回

```json
{"title":"Typesafe is not available in your region.","status":451}
```

- HTTP **451** 表示「因法律原因不可用」，是地区/出口限制，不是 key 或参数问题。
- **curl 不读取 macOS 系统代理设置**，只认 `http_proxy` / `https_proxy` / `all_proxy` 环境变量或 `~/.curlrc`。浏览器能打开、curl 打不开，通常就是这个原因。
- 浏览器走系统代理（本机为 `127.0.0.1:7890`），curl 直连时用的是本地出口 IP，于是被 CDN 拦截。
- 官方博客说明，服务目前部署在**美国西海岸**，公开性能评测也从西海岸发起；国内直连遇到地区限制并不意外。生产环境请使用公司合规出口，并先确认服务可用地区与条款。

**处理方式**：

```bash
# 单次请求显式指定代理
curl --proxy http://127.0.0.1:7890 ...

# 或为 curl 全局配置（注意：之后访问内网也走代理，需要时用 --noproxy 排除）
echo 'proxy = "http://127.0.0.1:7890"' >> ~/.curlrc
```

**合规提醒**：生产环境请使用公司批准的合规出口，并先确认服务条款与可用地区；不要以「绕过地区限制」作为生产方案。本机代理仅用于本次内网演示。

排查命令：

```bash
scutil --proxy                                  # 查看 macOS 系统代理
env | grep -i -E '^(http|https|all|no)_proxy'   # 查看 curl 会读取的变量
lsof -nP -iTCP:7890 -sTCP:LISTEN                # 检查本地代理是否在监听
```

## 3.4 验证连通性

先查模型列表（无需消耗判断额度）：

```bash
curl --proxy http://127.0.0.1:7890 \
  --fail-with-body --silent --show-error \
  https://api.typesafe.ai/v1/models \
  -H "Authorization: Bearer $TYPESAFE_API_KEY" | python3 -m json.tool
```

本次返回：

```json
{
  "models": [
    { "name": "jev-latest",  "release_date": "2026-10-22T02:00:00+00:00" },
    { "name": "jev-preview", "release_date": "2026-10-14T20:14:00+00:00" }
  ]
}
```

`jev-latest` 是随稳定版移动的别名；本次实际解析为 **`jev-1.14.0`**。需要可复现实验时，建议评估后固定到具体版本号。

## 3.5 错误码速查

| 状态码 | 常见原因 | 处理方法 |
|---|---|---|
| 400 | JSON / UTF-8 / BOM 错误，或超出上下文 | 检查编码（UTF-8 无 BOM）与错误说明；精简或分批 |
| 401 | 缺少或无效 API Key | 检查变量与 `Authorization: Bearer ...` |
| 413 | 请求体超过 32 MiB | 缩小请求体或分批 |
| 415 | 不支持的压缩编码 | 检查 `Content-Encoding`；示例无需压缩 |
| 422 | 缺必需字段或问题结构错误 | 检查 `model` / `state` / `questions` / `type` / `criteria` |
| 429 | 超出组织速率限制 | 减少并发，按 `retry-after` / 指数退避重试 |
| 451 | 地区/出口不可用 | 见 3.3，使用合规出口 |
| 529 | 服务暂时过载 | 延迟 + 指数退避重试 |

## 3.6 可选：Skill 安装、验证与更新（教程 §2–4）

**Skill 不是运行时依赖。** 直接 curl 调用 API 不需要安装 Skill、Python SDK 或任何额外库（教程 §2）。Skill 只是提供给编程助手的接入指南，帮助它查阅文档、设计问题、组合结果和编写调用代码；阅读 Skill、讨论方案本身也不需要 API Key（教程 §1.1）。

### 安装（三选一，教程 §3）

```bash
# 方式一：skills CLI，项目级（需 Node.js ≥ 22.20）
npx skills add typesafe-ai/skills --skill typesafe-ai

# 方式一：skills CLI，全局
npx skills add typesafe-ai/skills --skill typesafe-ai -g

# 方式二：Claude Code 插件
claude plugin marketplace add typesafe-ai/skills
claude plugin install typesafe@typesafe-ai
# 之后在对话中使用 /typesafe:typesafe-ai

# 方式三：手动复制完整目录（不能只复制 SKILL.md）
# Claude Code: <项目>/.claude/skills/typesafe-ai/
# Codex:       <项目>/.agents/skills/typesafe-ai/
```

### 验证（教程 §3.4）

```bash
npx skills list
npx skills list -g
```

然后在目标 Agent 中显式点名：

```text
请使用 typesafe-ai 技能，先说明这个技能能帮助我做什么，
并根据官方文档解释 Jev 的三种常用问题类型，暂时不要调用 API。
```

「文件存在 → 列表可见 → 实际会话能读取」是三个不同层次的检查；未加载时可重启 Agent，Claude Code 插件还可运行 `/reload-plugins`。Codex CLI / IDE 扩展可通过 `/skills` 或 `$typesafe-ai` 选择技能。

### 更新（教程 §3.5）

```bash
npx skills check
npx skills update

# Claude Code 插件
claude plugin marketplace update typesafe-ai
claude plugin update typesafe@typesafe-ai
# 随后重启或 /reload-plugins
```

手动安装则从官方仓库重新取得最新的完整 `skills/typesafe-ai` 目录替换，保留自己的定制内容后再替换。

### 直接阅读 Skill 原文（教程 §6.1）

```bash
curl --fail --silent --show-error --location \
  https://raw.githubusercontent.com/typesafe-ai/skills/main/skills/typesafe-ai/SKILL.md
```

安装后仍使用原来的编程助手；只有在真正发起判断请求时才调用 TypeSafe API。

---

# 4. 使用方法与问题设计

## 4.1 请求结构

```json
{
  "model": "jev-latest",
  "state": "<字符串 | JSON 对象 | 数组>",
  "questions": {
    "<问题ID>": {
      "type": "choice | noul | score",
      "instructions": "<给模型的判断任务，写清完整含义>",
      "criteria": "<choice 必填：对象；score 必填：有序数组；noul 可选>"
    }
  }
}
```

- 三个顶层字段 `model`、`state`、`questions` 必填。
- 问题 ID 由你定义，**模型看不到 ID**，只看到 `instructions` 和 `criteria`。因此问题正文必须自包含，例如：
  - ❌ `"instructions": "这个呢？"`（依赖问题 ID 的语义，模型无法理解）
  - ✅ `"instructions": "`message` 是否报告核心业务已经无法继续进行？"`
- 支持用反引号引用 state 中的字段，如 `` `message` ``、`` `candidates[0].text` ``。

**提交方式：内联或读文件（教程 §6.2）**

```bash
# 小请求：直接内联 JSON
curl ... -d '{ ... }'

# 复杂请求：写入 UTF-8 无 BOM 的 request.json，从文件读取
curl --fail-with-body --silent --show-error \
  https://api.typesafe.ai/v1/systemone \
  -H "Authorization: Bearer $TYPESAFE_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary '@request.json' \
  --output response.json
```

- `--data-binary` 自动使用 POST，不必再加 `-X POST`；它保留文件原始字节。
- `--output` 保存响应；HTTP 错误响应的 JSON 也可能写入该文件，**先检查退出码/状态码**再处理。
- 教程 §6.5 的场景复用方式：第 5.2–5.6 节分别给出 `state` 和 `questions` 两个对象，需要装入同一个 `model` / `state` / `questions` 外壳，不能直接拼接两个 JSON。

## 4.2 问题设计六条原则（教程 §1.3 + 官方文档）

1. **事实进 `state`，判断进 `instructions`**
   规则、候选、时间、时间戳、业务口径都放进 state；instructions 只描述要判断什么。
2. **选项/等级必须封闭且互斥可解释**
   Choice 的每个选项都应能独立描述清楚；Score 的等级要按从低到高排列，边界明确。
3. **一个信号一个问题**
   广告和辱骂可能同时成立，就分别问两个 Noul；不要用 Choice 强迫二选一。
4. **独立问题合并到一次请求**
   同一份 state 上的独立判断并行提交，减少往返；有依赖关系的拆成多轮。
5. **让程序做确定性的部分**
   排序、阈值比较、金额计算、日期换算、执行动作都由程序完成；Jev 只提供语义判断和原始概率。
6. **原子化提问，组合逻辑写在代码里**
   官方文档建议每个问题只做一个具体判断。需要多因素综合时（例如评估一个创业 pitch），拆成市场规模、技术可行性、差异化等独立问题，再在代码中加权组合；优先级变化时改系数，而不是重写提示词。

## 4.3 结果处理与程序分工

```text
Jev 负责：理解语言后的判断（分类、打分、是非）
程序负责：规则校验、阈值、排序、计算、重试、审计、执行
```

建议：

- **保留原始概率**，不要只存 `choice` / `score`；后续调整阈值无需重新请求。
- **阈值放在配置中**，用人工标注样本校准，不要硬编码「放之四海皆准」的通用值。
- **组合逻辑放代码**，例如「任一违规即隐藏」「高紧急度且业务中断才升级」。
- **对低置信结果走人工复核**，不要用 confidence 当自动执行授权。
- **记录模型版本和 usage**，便于回归与成本核算。

## 4.4 版本管理

- `jev-latest` 是移动别名；版本更新可能改变个别分数。
- 生产建议：先记录响应中的 `model`，用自有样本评估升级影响，再决定是否固定到具体版本（如 `jev-1.14.0`）。
- 本次同一示例在不同时间复现，结果差异约 0.02（如 0.93 → 0.91），属于正常推理波动。
- 官方 2026-10-14 发布 Jev 1.14.0；一周后 `jev-latest` 指向 1.14.0。`jev-preview` 的主要提升在多语言支持。官方表示会先发布弃用政策，并在弃用前提前通知（博客提到 60 天 / 30 天两档）。
- **实验特性（danger zone，官方明确不建议生产）**：`TypeSafe-Danger-Zone-Images: true`（图片可放入 state / instructions / criteria）、`TypeSafe-Danger-Zone-Long-Context: true`（更长上下文）、新类型 `box`（单个边界框，仅 1.14.0）。官方称其 jaggedness 太多、暂不为生产背书；本次未测试。参考 `docs.typesafe.ai/go/images`、`/go/box`、`/models#context-length`。

## 4.5 限制、重试与安全（教程 §6.4）

**常用 curl 参数**

| 参数 | 含义与用途 |
|---|---|
| `--fail-with-body` | HTTP 400 及以上保留响应体，同时返回非零退出码 |
| `--fail` | HTTP 错误时直接失败；教程仅在读取公共文档时使用 |
| `--silent --show-error` / `-sS` | 隐藏进度条，同时保留错误输出 |
| `--location` / `-L` | 跟随 HTTP 重定向 |
| `--data-binary @request.json` | 从文件读取请求体，保留原始字节 |
| `--output response.json` / `-o` | 将响应体保存到文件 |
| `--dump-header response-headers.txt` | 保存响应头，便于检查状态码与 `retry-after` |
| `--write-out` / `-w` | 输出状态码、总耗时等调用信息 |
| `--connect-timeout 10` / `--max-time 60` | 连接超时 / 整次调用最长耗时 |

每执行一次 POST 都会重新发起一次判断请求；教程中的 curl 示例**没有自动退避重试逻辑**（教程 §6.4）。

- 请求体上限 **32 MiB**；JSON 必须 **UTF-8 无 BOM**。
- 限流按**组织**计算；429 按 `retry-after` 与指数退避重试，529 延迟后退避。
- curl 示例本身**没有自动重试**；生产客户端需要自己实现退避、超时（建议连接 10s、总超时按业务设置）。
- API Key 只在服务端使用；日志中不要打印密钥。
- 一次请求的问题越多，token 越多；对超长候选批量处理时要分批。

## 4.6 用 Skill 驱动编程助手（教程 §4）

Skill 装上后，不需要手写提示词去教助手怎么调用。教程给出三种可直接复制的提示词：

**① 探索项目中的接入机会**

```text
使用 typesafe-ai 技能，阅读当前项目，找出需要语义判断的处理环节。
对每个建议说明输入、需要的问题类型、返回值和业务收益，
优先考虑复杂分类、候选筛选、结果排序或已有提取结果的验证，先给出建议。
```

**② 实现明确功能（以工单分流为例）**

```text
使用 typesafe-ai 技能，实现客服工单分流。
一次请求判断归属部门、紧急程度、用户情绪和业务是否中断。
问题定义与阈值集中管理，保留原始概率；实际路由逻辑放在代码中。
API Key 从 TYPESAFE_API_KEY 读取，先使用 jev-latest。
```

**③ 用少量样本验证设计**

```text
使用 typesafe-ai 技能，使用环境变量 TYPESAFE_API_KEY，
最多发起 5 次 Jev 请求，每次使用一条短样本，验证我给出的分类需求。
展示请求、模型版本、答案和 token 用量，并比较人工预期。
如果当前执行环境没有密钥，请说明缺少配置，不要在输出中显示密钥。
```

最简单的触发方式：「使用 typesafe-ai 技能，帮我设计一个用 Jev 处理用户反馈的功能。请先查阅当前官方文档，说明 state、questions 和程序后续处理逻辑。」（教程 §4.2）

注意：让助手发起实验会**实际消耗 API 配额**；教程中的示例响应是讲解用的，不代表已经替你执行。

## 4.7 结果不理想时先查什么（教程 §7.8）

按顺序排查，避免只调阈值掩盖输入问题：

1. **state 是否提供了必要证据？** 模型只能基于 state 判断。
2. **问题是否写完整？** 问题 ID 模型看不到，`instructions` 必须自包含。
3. **选项/等级是否有遗漏或重叠？** Choice 的选项概率总和为 1，漏掉的候选无法被选中。
4. **等级描述是否清晰、有序？** Score 的等级从 0 开始，边界要可解释。
5. **区分错误来源**：候选查找错误（程序）／模型判断错误／结果组合错误（程序）／服务失败（网络、限流）。
6. 用人工标注样本比较，决定阈值和是否需要重新设计问题。

---

# 5. 实测示例（本次真实请求）

> 以下结果均为 2026-11-01 实际调用所得，模型 `jev-1.14.0`，经本地代理访问。数字仅代表本次样本，不代表模型准确率。  
> 请求设计来自官方教程：最小示例见教程第 3 页；工单分流见 §5.1；工具路由、排序、审核、提取、去重见 §5.2–5.6；「女朋友聊天」来自 Playground 截图，非教程内容。

## 5.0 总览：共 9 个判断示例

本章共 **9 个判断示例**：5.1、5.2、5.3 各 1 个，5.4 含 6 个。另有 1 次模型列表查询（§3.4）和 3 段 Skill 提示词（§4.6），不计入判断示例；3 次延迟探测复用同一个简短 Noul，不重复计数。

| # | 场景 | 题型组合 | 关键结果 |
|---|---|---|---|
| 1 | 重复扣费投诉（最小示例） | noul | 紧急情绪 **0.96** |
| 2 | 工单分流（一次 4 问） | choice + score + choice + noul | technical / 紧急度 **2.0** / frustrated / 业务中断 **0.96** |
| 3 | 女朋友聊天（截图复现） | noul + score + choice | 不满 **0.91** / 程度 **1.96** / 潜台词 A **90%** |
| 4 | AI 助手选择工具 | 2 × choice | check_calendar / tomorrow_afternoon |
| 5 | 搜索结果排序 | 3 × score | **2.60 / 0.47 / 0.01** |
| 6 | 内容审核 | 2 × noul + score | 广告 **0.98** / 辱骂 **0.98** / 严重度 **2.0** |
| 7 | 信息提取 | choice + noul | 应付金额选 **c3（¥1,000.00）** |
| 8 | 商品去重 | score + 2 × noul | 匹配度 **2.0** / 名称等价 **0.94** / 规格冲突 **0.05** |
| 9 | 英文 Stripe 工单 | noul | 紧急度 **0.98**（中文同义 0.96） |

教程 §5.1–5.6 的六个完整场景（示例 2、4、5、6、7、8）合计 **3,775 input / 448 output tokens**；加上示例 1、3、9，**9 个示例合计 4,990 input / 572 output tokens**；单个请求约 300～750 input tokens。

**覆盖关系**：`noul` 出现在示例 1、2、3、6、7、8、9；`choice` 出现在 2、3、4、7；`score` 出现在 2、3、5、6、8。单问示例 1、9；多问示例 2–8。业务上覆盖路由、排序、审核、提取、去重五类典型决策。

> **现场复跑**：先执行 §3.2 的 `export`，代理按 §3.3 配置。完整可执行脚本见附录 A.2（`jev-demo-all.sh`）；模型输出有随机性，复跑数值与本章首次结果会有差异。

## 5.1 示例 1：重复扣费投诉（Noul，教程第 3 页）

请求：

```bash
curl --proxy http://127.0.0.1:7890 \
  -X POST https://api.typesafe.ai/v1/systemone \
  -H "Authorization: Bearer $TYPESAFE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "state": "客户说：我被重复扣费了，请立刻解决！",
    "model": "jev-latest",
    "questions": {
      "urgency": {
        "type": "noul",
        "instructions": "这条消息是否表达了紧急情绪？"
      }
    }
  }'
```

响应（节选）：

```json
{
  "model": "jev-1.14.0",
  "answers": { "urgency": { "type": "noul", "noul": 0.96 } },
  "usage": { "input_tokens": 298, "output_tokens": 21 }
}
```

**程序动作**：设阈值（例如 > 0.8）进入优先队列；退款、查重和实际处理仍由业务系统完成。

**读法**：`answers.urgency.noul = 0.96`，即「表达了紧急情绪」的概率为 96%，**不是 96% 准确率，也不是退款概率**。这个最小请求适合验证连通性、最小计费和单信号接入；noul 用于二值判断，不需要生成文本。

## 5.2 示例 2：工单分流，一次问 4 个问题（教程 §5.1）

请求：

```json
{
  "model": "jev-latest",
  "state": {
    "message": "接口持续返回 500，线上订单全部失败，已经等了半小时，太耽误事了，请立即处理！"
  },
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "应该由哪个部门优先处理 `message` 中的问题？",
      "criteria": {
        "technical": "程序故障、接口报错、系统不可用",
        "billing": "扣款、账单、发票问题",
        "sales": "售前咨询、报价和购买方案",
        "other": "不属于以上类别，或现有信息无法确定"
      }
    },
    "urgency": {
      "type": "score",
      "instructions": "`message` 描述的问题有多紧急？",
      "criteria": [
        "无时间要求，可以等待常规处理",
        "希望尽快处理，但未报告业务中断",
        "业务已中断，或明确要求立即处理"
      ]
    },
    "tone": {
      "type": "choice",
      "instructions": "`message` 中客户表现出的主要情绪是什么？",
      "criteria": {
        "calm": "平静陈述事实，没有明显不满",
        "frustrated": "明确不满或抱怨，但没有激烈攻击",
        "angry": "激烈愤怒、辱骂或攻击性表达"
      }
    },
    "business_blocked": {
      "type": "noul",
      "instructions": "`message` 是否报告核心业务已经无法继续进行？"
    }
  }
}
```

结果：

| 问题 | 类型 | 结果 | 置信度 / 分布 |
|---|---|---|---|
| department | choice | `technical` | confidence 1.0（technical 100%） |
| urgency | score（0–2） | **2.0** | confidence 1.0（等级 2 占 100%） |
| tone | choice | `frustrated` | confidence 0.97（frustrated 98% / angry 2%） |
| business_blocked | noul | **0.96** | — |

usage：677 input / 120 output。

**程序后续逻辑**：`department = technical` → 进技术队列；`urgency = 2.0` → 高优；`business_blocked = 0.96` → 升级处理；`tone = frustrated` → 保留为独立信号，不直接影响路由。

**读法**：`tone` 的最大概率是 0.98，但 `confidence` 是 0.97，两个字段不要混用。四个问题互相独立、并行返回；state 只计一次输入，输出 token 随问题数增加。

## 5.3 示例 3：「女朋友聊天」（复现 Playground 截图）

state：

```json
{
  "背景": "女朋友想聊天，男朋友却一直在玩游戏。",
  "聊天记录": [
    "女朋友：今天工作好烦啊。",
    "男朋友：嗯。",
    "女朋友：算了，你忙吧，我不打扰你了。"
  ]
}
```

问题与结果：

| 问题 | 类型 | 本次 API | 截图结果 |
|---|---|---|---|
| 是否不满 | noul | **0.91** | 93% |
| 不满程度 | score（0–3） | **1.96**，confidence 0.97 | 1.93，confidence 93% |
| 潜台词 | choice | **A 90%**，confidence 0.87 | A 100% |

分数拆解（本次）：

```text
等级 0（没有明显不满）     0%
等级 1（有些不满，平和）   3%
等级 2（明显不满，失望）  97%   ← 几乎全部集中
等级 3（非常不满，愤怒）   0%

score = 0.03×1 + 0.97×2 ≈ 1.96
```

usage：615 input / 82 output。

**程序动作**：这个例子偏演示性质，不是正式业务。实际接入时应先固定选项文本、再做回归测试；它说明同一输入可以同时输出「是否」「程度」「离散解释」三种信号。

**读法**：字面上「算了，你忙吧，我不打扰你了」是体贴退让，但模型给出 91% 的不满概率、等级集中在「明显不满但未到愤怒」，潜台词选「希望男朋友放下游戏认真陪聊」90%，「准备冷战」仅 8%。模型读懂了 surface politeness 下的赌气。`confidence 0.87` 是模型对这个 choice 的把握，不是 A 的概率（A 的概率是 0.90）。

> 注：第三个「潜台词」问题的四个选项在截图中被截断，本次使用的选项文案为按语境补写，因此概率与截图不完全可比；前两个问题与截图高度吻合。

## 5.4 示例 4–9：其余六个场景（教程 §5.2–5.6、第 4 页）

### 示例 4：AI 助手选择工具（2 × choice，教程 §5.2）

**业务问题**：把自然语言请求映射到已注册工具，并选出已知的枚举参数。Jev 只做选择和参数判断，不执行工具本身。

**请求设计**：

- `state`：`message`、`current_date = 2026-11-01`、`timezone = Asia/Shanghai`，以及 `available_tools`（`check_calendar` / `search_docs` 的说明）。
- `tool`（choice）：在 `check_calendar`、`search_docs`、`unsupported` 中选一个。
- `calendar_window`（choice）：今天下午 / 明天下午 / 其他或未指定。instructions 明确「相对日期以 `current_date` 和 `timezone` 为准」，并说明它是日历分支的参数，不依赖 `tool` 的答案。

**实测结果**：

| 问题 | 结果 | confidence |
|---|---|---|
| tool | `check_calendar` | 1.0 |
| calendar_window | `tomorrow_afternoon` | 1.0 |

usage：652 input / 94 output。

**程序如何消费**：

1. `tool = check_calendar`，只读取 `calendar_window`；
2. 程序把 `tomorrow_afternoon` 换算成 2026-11-02 13:00–18:00（Asia/Shanghai）；
3. 用当前用户的权限调用日历工具。

如果 `tool = unsupported`，走澄清分支，忽略时间窗口结果。

**这个例子说明**：日期换算、权限校验、工具执行都应由程序完成。闭集参数 + 两个独立问题，避免模型做相对日期算术，也避免第二问依赖第一问的答案。

### 示例 5：搜索结果排序（3 × score，教程 §5.3）

**业务问题**：检索系统已经召回 3 篇候选，需要判断每篇与问题的相关程度，再排序取前 K，而不是让模型生成答案。

**请求设计**：

- `state`：`query` + `candidates` 数组，每项包含 `id` 和 `text`。
- 3 个 `score` 问题 `relevance_d1/d2/d3`，使用**同一套 4 级标准**：0 内容无关、1 主题相关但未提供所需信息、2 提供部分信息仍缺关键、3 直接提供核心信息。
- instructions 分别指向 `candidates[0..2].text`，保证每个问题作用于哪篇候选没有歧义。

**实测结果**：

| 候选 | 内容 | score | confidence | 概率分布（0/1/2/3 档） |
|---|---|---|---|---|
| d1 | PowerShell curl.exe 提交 UTF-8 无 BOM JSON | **2.60** | 0.62 | 0 / 3% / 32% / 65% |
| d2 | 创建 TypeSafe 账号和 API Key | 0.47 | 0.53 | 54% / 45% / 1% / 0 |
| d3 | 咖啡机安装与保养 | 0.01 | 1.0 | 100% / 0 / 0 / 0 |

usage：749 input / 55 output。

**程序如何消费**：

1. 按 `score` 降序得到 d1 > d2 > d3；
2. 分数相同时用原始召回顺序做稳定次排序；
3. 取前 K。保留原始 `score` 和 `probabilities`，后续调整阈值不必重新请求。

**这个例子说明**：

- `score` 是各档概率的加权结果，可以是小数，不是 0–3 的整数档位。
- d1 分数高但 confidence 只有 0.62（概率分散在 2/3 档）；d3 分数低但 confidence 1.0。**排序看分数，复核看置信度**，两个信号分开用。
- 多候选必须使用同一套 rubric，否则各候选的分数不可比。

### 示例 6：内容审核（2 × noul + score，教程 §5.4）

**业务问题**：一条评论可能同时是广告又是辱骂，需要多标签判断，并给出违规严重度。

**请求设计**：

- `state`：`comment` + `policy`（`spam` 和 `insult` 两段规则原文）。
- `is_spam`（noul）：依据 `policy.spam`，评论是否包含广告推销。
- `is_insult`（noul）：依据 `policy.insult`，是否包含针对个人的辱骂。
- `severity`（score，0–2）：依据 policy 判断违规程度（0 无违规、1 轻微、2 直接广告或明确辱骂）。
- 不使用一个 choice 的原因：广告和辱骂可以同时成立，一个信号一个问题。

**实测结果**：

| 问题 | 结果 | confidence |
|---|---|---|
| is_spam | **0.98** | — |
| is_insult | **0.98** | — |
| severity | **2.0** | 1.0 |

usage：527 input / 53 output。

**程序如何消费**：把三个信号与业务阈值组合，例如「spam 或 insult > 0.9 → 隐藏/送审」「severity = 2 → 高优复核」。组合规则写在代码里，并保留原始概率和 policy 版本用于审计。

**这个例子说明**：Noul 之间不要求概率和为 1；把审核规则放进 state 后，调整规则不需要改问题结构；0.98 是「模型判断为是的概率」，不是「98% 准确率」。

### 示例 7：信息提取（choice + noul，教程 §5.5）

**业务问题**：文本里有多个金额，要选「本次应付金额」，且值必须来自原文，不能让模型自己计算或编造。

**请求设计**：

- `state`：`document` + `candidates`（程序先用正则/解析器预提取的金额，保留原文）。
- `payable_candidate`（choice）：在 c1/c2/c3/none 中选择。
- `has_payable_amount`（noul）：原文是否明确给出了本次应付金额，防止信息不足时被迫选一个。

**实测结果**：

| 问题 | 结果 | confidence |
|---|---|---|
| payable_candidate | **`c3` → ¥1,000.00** | 1.0 |
| has_payable_amount | **0.99** | — |

usage：562 input / 71 output。

**程序如何消费**：

1. `choice = c3`，直接复制 `state.candidates.c3` 的原文 `¥1,000.00`；
2. 去除货币符号和千分位，转成十进制 `1000.00`；
3. 保留原始字符串。若 `choice = none` 或 `has_payable_amount` 低于阈值，返回缺失或交人工确认，不强制选值。

**这个例子说明**：候选由程序生成，模型只负责「选」；金额的格式转换和计算在代码里。候选漏了是程序的问题，应先修候选查找，而不是换模型。

### 示例 8：商品去重（score + 2 × noul，教程 §5.6）

**业务问题**：两条来自不同来源的商品记录，是否可能描述同一商品及规格？输出可复核的重复候选，而不是直接合并。

**请求设计**：

- `state`：`entity_type = product` + `entity_a` / `entity_b`，各含 `name`、`brand`、`model`、`spec`。
- `match_strength`（score，0–2）：0 明确不同、1 信息缺失无法确认、2 关键信息一致且名称差异可解释。
- `names_equivalent`（noul）：结合品牌、型号、规格，两个名称是否是同一商品的不同表述。
- `spec_conflict`（noul）：颜色、容量、包装数量是否存在明确冲突。

**实测结果**：

| 问题 | 结果 | confidence |
|---|---|---|
| match_strength | **2.0** | 1.0 |
| names_equivalent | **0.94** | — |
| spec_conflict | **0.05** | — |

usage：608 input / 55 output。

**程序如何消费**：先在代码里做精确字段比较（品牌、型号），再结合语义信号：高匹配 + 名称等价 + 无规格冲突 → 生成「待合并」候选，展示原文证据，交业务规则或人工确认；明确冲突的保持分离；信息不足的进复核队列。

**这个例子说明**：「单副装」vs「1 副」被判为不冲突（`spec_conflict` 仅 0.05），说明模型理解语义等价而非字面匹配；但精确比较和合并动作仍由程序完成。做客户去重时，必须同时改字段和问题定义，不能只把 `entity_type` 改成 customer。

### 示例 9：英文 Stripe 工单（noul，教程第 4 页）

**业务问题**：英文客服工单是否紧急；同时与中文同义样本对照，观察语言一致性。

**请求设计**：

- `state`：一段英文工单（连接 Stripe 失败 3 天、影响销售、要求 ASAP）。
- `urgency`（noul）：`Does this message express urgency?`

**实测结果**：

| 问题 | 结果 |
|---|---|
| urgency | **0.98** |

usage：302 input / 21 output。对照：中文「被重复扣费，请立刻解决」为 **0.96**。

**程序如何消费**：与中文场景一样，设置阈值、进入优先级队列；语言不影响请求结构。

**这个例子说明**：中英文判断基本一致；但官方说明英文是主训练语言，中文业务仍应使用自有样本验证边界案例，不能仅凭一个例子下结论。

## 5.5 实测观察

1. **Score 是概率加权值，不是离散等级**：2.60、1.96 这类小数很正常；排序/设阈值时按连续值处理。
2. **confidence 与分数可能背离**：高分之下的分布若集中在两档，confidence 会偏低；不要只看一个字段。
3. **Choice 的 confidence 也不是最大概率**：实测 tone 的最大概率 0.98，confidence 为 0.97。
4. **Noul 可以带 `criteria` 定义 true/false 口径**：截图示例正是这样做的，有助于对齐业务语义。
5. **中英文一致性好**：同义紧急投诉 0.96 / 0.98；但官方说明英文是主训练语言，中文业务仍应使用自己的样本验证。
6. **复跑有波动**：同一示例多次运行，分数/置信度会变化；本次复跑中部分候选的分数差异可达约 0.1，示例 3 因选项补写差异更明显。阈值必须用自有样本校准，版本升级要做回归测试。
7. **输出可控**：所有答案都落在预设选项/等级内，不存在「模型编造一个选项」的问题。
8. **与官网性能口径的差异**：官网首页示例为 `0.114s` / `$0.000081`，官方博客称端到端 70–500ms；本次经本地代理的完整 HTTP 往返为 0.84–1.30s，包含建连、代理与地区链路开销，测量条件不同，不能直接对比，也未复现官方基准。

---

# 6. 落地建议

## 6.1 适合 / 不适合

| 适合 | 不适合 |
|---|---|
| 工单/线索路由与优先级 | 撰写客户回复、总结、翻译 |
| 评论/内容审核的多标签判断 | 开放域问答、多步推理 |
| 意图 → 已注册工具/参数选择 | 需要自主调用工具完成任务的 Agent |
| 搜索结果重排、候选筛选 | 判断标准还在探索、无法枚举的任务 |
| 从候选值中选字段（金额、地址） | 需要多轮记忆的对话 |
| 商品/客户去重的语义复核 | 图像/音频等多模态输入 |

## 6.2 常见接入模式

| 模式 | 说明 | 例子 |
|---|---|---|
| **闸门（Gate）** | 先判断是否拦截/送审 | 广告、辱骂、越界承诺 |
| **路由（Router）** | 判断去哪个队列/工具 | 部门、意图、工具+参数 |
| **分级（Triage）** | 有序评分决定优先级 | 紧急度、风险等级 |
| **提取（Extract）** | 在程序给出的候选中选值 | 应付金额、地址、单号 |
| **重排（Rank）** | 对召回结果统一打分排序 | 搜索、推荐、FAQ |
| **复核（Guardrail）** | 校验 LLM 输出是否违规/越界 | 生成内容发布前检查 |

## 6.3 试点四步

1. **选一个高频、边界清晰的判断环节**（例如工单部门路由），收集 50–100 条真实样本 + 人工标注。
2. **设计 state / questions**：事实前置、选项封闭、一个信号一个问题；先跑通再谈阈值。
3. **对比人工标注**：看准确率、混淆分布、低置信样本；阈值用样本校准，保留原始概率。
4. **小流量接入**：低风险自动处理、高风险人工复核；记录模型版本、usage、判定结果，持续回归。

## 6.4 需要提前对齐的预期

- Jev 是**判断组件**，不是「更便宜的 ChatGPT」；用它替代生成式模型的场景会失望。
- 准确率必须用**自己的数据**评估；官方示例和本次实测都不是业务准确率承诺。
- 中文可用，但官方主训练语言是英文，中文边界案例要重点抽查。
- 服务存在地区可用性限制，生产部署前先确认合规出口与条款。

## 6.5 常见问题（教程 §7）

| 问题 | 处理 |
|---|---|
| 安装 Skill 后助手没有使用 | 确认安装时选对了 Agent 和范围；用「使用 typesafe-ai 技能」显式点名；检查完整目录中的 SKILL.md；重启 Agent 或运行 `/reload-plugins`（§7.1） |
| 设置变量后仍提示认证失败 | 确认实际运行命令的终端/Agent 执行环境里有 `TYPESAFE_API_KEY`；POSIX 用 `$TYPESAFE_API_KEY`，PowerShell 用 `$env:TYPESAFE_API_KEY`；只检查是否存在，不打印密钥（§7.3） |
| Windows 提示无法运行 npx.ps1 | 使用 `npx.cmd` / `npm.cmd`，无需修改 PowerShell 执行策略（§7.2） |
| 分数、概率、置信度怎么用 | Choice 用 `choice`，多候选保留 `probabilities`；Noul 是「是」的概率，多个不要求和为 1；Score 表示程度，不是 0–1 概率；阈值用真实样本评估（§7.5） |
| 中文能不能用 | 可以；官方以英文为主要训练语言，中文边界案例需用自有样本验证（§7.6） |
| 模型会自动调用工具、退款或合并数据吗 | 不会。一次请求只返回判断结果；执行动作、权限、缺失分支由程序负责（§7.7） |
| 示例结果不理想 | 按 4.7 的顺序排查（§7.8） |

---

# 7. 附录

## A. 快速复现脚本

保存为 `jev-demo.sh`，按需修改 `PROXY`（不需要代理就留空）：

```bash
#!/bin/bash
PROXY="http://127.0.0.1:7890"   # 直连可用时设为空字符串
URL="https://api.typesafe.ai/v1/systemone"

ask() {
  local name="$1"; local req; req=$(mktemp)
  cat > "$req"
  echo "===== $name ====="
  echo "----- 请求参数（model / state / questions）-----"
  python3 -m json.tool --no-ensure-ascii "$req" 2>/dev/null || cat "$req"
  echo "----- 响应 -----"
  local args=(--fail-with-body --silent --show-error
              --connect-timeout 10 --max-time 60
              -H "Authorization: Bearer $TYPESAFE_API_KEY"
              -H "Content-Type: application/json"
              --data-binary "@$req" "$URL")
  [ -n "$PROXY" ] && args=(--proxy "$PROXY" "${args[@]}")
  curl "${args[@]}" | python3 -m json.tool --no-ensure-ascii
  rm -f "$req"
}

ask "重复扣费投诉" <<'JSON'
{
  "model": "jev-latest",
  "state": "客户说：我被重复扣费了，请立刻解决！",
  "questions": {
    "urgency": { "type": "noul", "instructions": "这条消息是否表达了紧急情绪？" }
  }
}
JSON
```

运行：

```bash
chmod +x jev-demo.sh
source ~/.bash_profile      # 确保 TYPESAFE_API_KEY 已加载
./jev-demo.sh
```

### A.2 一键复跑全部 9 个示例

同目录的 `jev-demo-all.sh` 会依次查询模型列表并发送 §5 的 9 个示例；脚本只读取环境变量，不内置 Key。

```bash
source ~/.bash_profile          # 或先执行 §3.2 的 export
bash jev-demo-all.sh            # 默认走 127.0.0.1:7890
PROXY="" bash jev-demo-all.sh   # 直连可用时关闭代理
```

说明：

- 脚本中的示例 3「潜台词」选项为截图补写，复跑概率与文档首次运行可能不同。
- 模型判断有随机性；分数/置信度复跑会波动，文档数字只作参考，不是固定输出。
- 9 个示例首次运行合计约 4,990 input / 572 output tokens；脚本会真实计费。
- 每个脚本会先打印完整请求参数（`model` / `state` / `questions`），再打印响应，便于逐字段对照。
- 如果只需要最小验证，用 A.1 的示例 1 即可。

每个示例也有独立脚本，放在 `examples/` 下，适合逐页演示或单独排障：

| # | 独立脚本 | 首次运行参考 |
|---|---|---|
| 1 | `examples/01-duplicate-charge.sh` | urgency 0.96 |
| 2 | `examples/02-ticket-triage.sh` | technical / 2.0 / frustrated / 0.96 |
| 3 | `examples/03-girlfriend-chat.sh` | 不满 0.91 / 程度 1.96 / A 90%（选项补写，复跑会变） |
| 4 | `examples/04-tool-routing.sh` | check_calendar / tomorrow_afternoon |
| 5 | `examples/05-search-ranking.sh` | 2.60 / 0.47 / 0.01（复跑会波动） |
| 6 | `examples/06-moderation.sh` | spam 0.98 / insult 0.98 / severity 2.0 |
| 7 | `examples/07-extraction.sh` | c3 / has_payable_amount 0.99 |
| 8 | `examples/08-product-dedup.sh` | match 2.0 / names 0.94 / conflict 0.05 |
| 9 | `examples/09-stripe-english.sh` | urgency 0.98 |

运行方式与 A.2 相同，例如：

```bash
source ~/.bash_profile
bash examples/05-search-ranking.sh
```

## B. 名词表

| 术语 | 解释 |
|---|---|
| System One | TypeSafe 的判断模型系列名称 |
| Jev | System One 的具体模型（本次 jev-1.14.0） |
| state | 待判断的证据，支持字符串 / 对象 / 数组 |
| questions | 问题集合，键为程序读取用的 ID |
| choice | 封闭选项单选题 |
| noul | 是/否概率判断题 |
| score | 有序等级评分题，分数可小数 |
| criteria | 选项或等级的定义 |
| confidence | 答案分布的确定程度，非准确率 |
| legend | Score 的等级编号到描述的映射 |
| fail-with-body | HTTP 错误时保留响应体并返回非零退出码 |
| BOM | 字节顺序标记，JSON 必须无 BOM |

## C. 参考资料与教程章节对照

### 官方教程章节对照

| 教程章节 | 页码 | 内容 | 本材料对应 |
|---|---|---|---|
| 快速上手 | 2–4 | 配置 Key、查询模型、发送 Noul、Stripe 示例 | 3.2、3.4、5.1、5.4 |
| §1 基础概念 | 5 | Skill / Jev / Key、三种问题类型、如何组织问题 | 1.1–1.4、4.1–4.3 |
| §2 环境准备 | 6 | curl、Node、Git、API Key 要求 | 3.1 |
| §3 安装、验证和更新 Skill | 6–9 | 三种安装方式、验证、更新 | 3.6 |
| §4 配置 API Key 与使用 Skill | 9–10 | 触发方式、三个工作提示词 | 3.2、4.6 |
| §5 六个使用场景 | 11–18 | 工单、工具、排序、审核、提取、去重 | 5.2、5.4 |
| §6 curl 进阶用法 | 18–22 | 读取 SKILL.md、文件提交、结果提取、参数、场景外壳 | 4.1、4.5、5 |
| §7 常见问题 | 22–23 | 安装、Windows、认证、错误码、分数用法、中文、边界 | 3.5、4.7、6.5 |
| §8 验证范围 | 24 | 官方教程自身的验证边界 | 附录 D |
| §9 官方参考资料 | 25 | 官方文档与仓库索引 | 本节 |

### 链接与接口

- 官网首页：`https://typesafe.ai/`
- 官方文档：`https://docs.typesafe.ai/introduction`（完整文档索引：`https://docs.typesafe.ai/llms.txt`）
- API 控制台：`https://console.typesafe.ai/`
- 判断接口：`POST https://api.typesafe.ai/v1/systemone`
- 模型列表：`GET https://api.typesafe.ai/v1/models`
- 官方博客：
  - Introducing System One Models & Jev：`https://typesafe.ai/blog/introducing-system-one-models-and-jev`
  - Jev 1.14 发布说明：`https://typesafe.ai/blog/jev-1-14`
  - 客户案例：`https://typesafe.ai/blog/jack-jill-jev-case-study`
- Enterprise：`https://typesafe.ai/enterprise`
- GitHub：`https://github.com/typesafe-ai`；Skill 仓库：`https://github.com/typesafe-ai/skills`
- Discord：`https://discord.gg/typesafe`
- 支持邮箱：`support@typesafe.ai`
- 社交媒体：`https://www.linkedin.com/company/typesafe-ai/`、`https://x.com/typesafeai`
- 教程 §9 列出的官方主题：问题类型（Choice / Noul / Score）、构建指南、置信度、请求规则与错误、Function calling、Speculative fan-out、Re-ranking、Guardrails、Pre-parsed value extraction、Entity alignment、Classification using confidence

## D. 实测声明

- 本文首次数字来自 2026-11-01 的 14 次真实 HTTP 调用（12 次成功判断请求、1 次模型查询、1 次 451 拦截），单机、单地区、小样本。
- 同日用 `jev-demo-all.sh` 复跑验证：9 个判断请求 + 1 次模型查询均返回 HTTP 200；复跑数值与首次运行存在随机波动（见 §5.5 第 6 条），说明模型输出不是逐位可重复的固定值。
- 未对任何业务场景做准确率评测；数字仅用于展示 API 行为与输出形态，不应作为选型依据或 SLA 承诺。
- 官方教程 §8 明确说明：其验证范围为文档与示例的**静态验证**，本机未安装 PowerShell，未在 Windows 上实际运行示例，未使用真实 API Key 发起模型查询或判断请求，也未对六个业务场景做准确率评测。本材料在教程基础上补做了 12 次真实判断调用，但仍不构成准确率评测。
- 官网与官方文档抓取于 2026-11-01；官方性能/价格数字（193.6×、444.6×、$42/B、238×、70–500ms 等）**未在本材料中独立验证**，仅作背景引用，且官方博客自己提醒读者以自己的用例评测为准。
- Playground 截图数据来自用户提供，仅用于对照。
- **分享前检查**：§3.2 含真实 API Key。对外发送、上传网盘/仓库或扩大分享范围前，删除该块并在 TypeSafe 控制台轮换 Key；确认文档未被 Git 跟踪或同步到公开位置。现场复跑时也不要投屏 Key 所在段落。

---

*文档结束。建议分享时重点讲第 1.2 节的「生成 vs 判断」心智模型和第 5 节的实测结果，第 3.3 节的代理坑可作为现场排障彩蛋。*
