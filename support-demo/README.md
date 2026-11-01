# 睡眠手环 · 智能排障台

一个“生产环境模拟”Demo：用户买了睡眠手环，戴了一晚，第二天 App 里没有睡眠数据。页面通过对话逐项收集证据，每一步调用一次 Jev，最后再调用一次 Jev 做根因判断，并给出“用户侧 / 客服侧 / 研发质量侧”的处理建议。

## 为什么不是纯前端 HTML

浏览器直接调用 `api.typesafe.ai` 会有两个问题：

1. API Key 会进入前端 JS，等于公开；
2. 浏览器跨域、代理和密钥轮换都不适合生产。

所以这里把页面做成静态 HTML，但所有 Jev 请求都由本地 Python 服务转发：

```text
浏览器 index.html
      │  POST /api/turn、/api/final（不含 Key）
      ▼
support-demo/server.py
      │  Authorization: Bearer $TYPESAFE_API_KEY
      ▼
https://api.typesafe.ai/v1/systemone
```

API Key 只存在于服务端环境变量中，HTML 和浏览器网络请求里都没有。

## 运行

```bash
cd /Users/jerry/project/jev_demo
bash support-demo/start.sh
```

`start.sh` 会在 `TYPESAFE_API_KEY` 未设置时尝试读取 `~/.bash_profile`。也可以手动运行：

```bash
source ~/.bash_profile
python3 support-demo/server.py
```

然后打开：

```text
http://127.0.0.1:8787
```

默认使用 ClashX 代理 `http://127.0.0.1:7890`。如果当前网络可直连，或你在其他环境运行：

```bash
TYPESAFE_PROXY="" python3 support-demo/server.py
```

也可以用 `PORT=9000` 改端口。

> 每次点击都会真实调用 Jev，并产生 token 费用。快捷回答按钮只是帮演示者快速走完整条链路。

## 六个排查方向

| # | 阶段 | 要回答的问题 | 主要覆盖的根因 |
|---|---|---|---|
| 1 | 佩戴检查 | 传感器是否贴着手腕内侧，表带是否松动 | 佩戴位置、松紧、未佩戴 |
| 2 | 电量与开机 | 是否有电、能否开机、充电是否正常 | 电量、充电触点、关机 |
| 3 | 蓝牙与同步 | 是否连接、是否同步成功、是否卡在旧数据 | 蓝牙、同步失败、数据延迟 |
| 4 | App 权限与账号 | 权限、账号绑定、App 版本 / 换机 | 权限、账号、版本兼容 |
| 5 | 佩戴时长与数据预期 | 是否整晚佩戴、是否少于 4 小时、是否小睡 | 数据不足、睡眠阈值、用户预期 |
| 6 | 硬件自检 | 震动 / 亮屏 / 充电、摔碰进水、固件 | 硬件、固件、需要研发检测 |

最终归为 7 类：

- `wearing_issue`：佩戴方式问题（用户侧）
- `power_issue`：电量 / 开机问题（用户侧）
- `sync_issue`：蓝牙 / 同步链路（用户侧 / 客服）
- `app_issue`：App 权限 / 账号（用户侧 / 客服）
- `data_sufficiency`：佩戴时长 / 数据延迟 / 产品阈值（客服解释或继续观察）
- `hardware_fault`：硬件 / 固件故障（研发、质量侧）
- `needs_human`：信息不足 / 回答矛盾 / 需要人工（客服）

## 已验证场景

真实跑通的结果示例（Jev 输出有波动，以下不是固定值）：

| 场景 | 最终路由 | 说明 |
|---|---|---|
| 表带偏松，其余正常 | 佩戴方式问题（用户侧） | 规则累计佩戴 +3，最终置信度约 98% |
| 其余正常，硬件自检异常 | 硬件 / 固件故障（研发 / 质量侧） | `needs_human` 约 84%，但规则侧硬件信号 +5，保留研发路由并提示人工复核 |
| 六项都回答“不确定” | 信息不足 / 需人工 | 规则累计 `needs_human` +5，转客服人工 |

## 每次请求在做什么

### 每轮回答：2 个问题

`POST /api/turn` 的请求体里包含当前阶段、用户回答和历史问答。服务端组装：

```json
{
  "model": "jev-latest",
  "state": {
    "product": "睡眠手环",
    "complaint": "用户购买睡眠手环，佩戴一整晚后，第二天 App 中没有睡眠数据。",
    "stage": "佩戴检查",
    "current_question": "...",
    "user_answer": "戴是戴了，但表带偏松，手环会滑动甚至翻转。",
    "qa_history": []
  },
  "questions": {
    "answer_class": {
      "type": "choice",
      "instructions": "根据 `current_question` 和 `user_answer`，判断用户的佩戴情况属于哪一类。",
      "criteria": {
        "correct": "...",
        "loose": "...",
        "wrong_position": "...",
        "not_worn": "...",
        "unclear": "..."
      }
    },
    "answer_clear": {
      "type": "noul",
      "instructions": "用户是否明确、具体地回答了当前问题？"
    }
  }
}
```

`answer_class` 把自然语言回答映射成结构化信号；`answer_clear` 用来发现“记不清 / 不确定”的回答，避免后面的规则过度自信。

### 最后一轮：3 个问题

`POST /api/final` 把六轮问答、结构化信号和规则累计分一起交给 Jev：

- `final_cause`（`choice`）：最可能的根因；
- `needs_human`（`noul`）：是否需要人工介入；
- `severity`（`score`）：影响程度 / 升级优先级（0–2）。

服务端还有一层规则守卫：

- 如果最终置信度低于 0.4，且规则侧没有形成强信号，或出现 4 个以上含糊回答，就转为人工复核；
- 如果 Jev 只是建议人工复核，但规则侧已有明确信号（例如硬件自检异常累计分 ≥ 3），则保留主因，同时附上“建议人工复核”的提示，避免把明确的研发 / 质量路径误转成纯人工问题。

## 文件

```text
support-demo/
├── start.sh     # 读取环境变量并启动服务
├── index.html   # 对话界面、诊断侧栏、API 原始请求 / 响应查看器
├── server.py    # 静态页 + Jev 代理 + 阶段定义 + 规则守卫
└── README.md
```

## 生产化还需要补什么

这个 Demo 展示了交互和判断链路，不包含真实客服系统所需的生产能力：

- 登录、会话隔离、限流与审计；
- 用户文本的 PII 脱敏、日志保留策略；
- 用户文本会进入 Jev `state`，需要提示注入防护和更严格的输入校验（当前 Demo 只做了长度截断）；
- 设备真实日志（固件版本、传感器原始数据、同步时间线）的接入；
- 人工坐席接管、工单系统和 RMA 流程；
- 网络出站合规，不要把本地代理当作生产网络方案；
- API Key 轮换、服务端密钥管理，以及失败重试和降级策略。
