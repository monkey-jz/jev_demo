# 睡眠手环 · 智能排障台

一个“生产环境模拟”Demo：用户买了睡眠手环，戴了一晚，第二天 App 里没有睡眠数据。页面通过对话逐项收集证据，每一步调用一次 Jev，最后再调用一次 Jev 做根因判断，并给出“用户侧 / 客服侧 / 研发质量侧”的处理建议。

## 换一台电脑：最短启动路径

### 0. 前置条件

- Python **3.8+**（推荐 3.9+）
- 能访问 `https://api.jevgo.cn` 的网络（如无直连，可走代理；也可用 `JEV_API_URL` 改回官方 `https://api.typesafe.ai/v1/systemone`）
- 一个可用的 `TYPESAFE_API_KEY`
- macOS / Linux：可直接用 `start.sh`；Windows：用 PowerShell 手动启动，或 Git Bash / WSL

### 1. 拉取仓库

```bash
git clone https://github.com/monkey-jz/jev_demo.git
cd jev_demo
```

确认 `support-demo/index.html` 存在。如果不存在，先执行 `git pull` 或确认拉取的是最新分支。

如果 `git clone` 超时或被重置，说明这台电脑需要先走代理。把下面的代理地址换成实际地址：

```bash
git -c http.proxy=http://127.0.0.1:7890 -c http.version=HTTP/1.1 \
  clone https://github.com/monkey-jz/jev_demo.git
```

Git 的代理只影响拉取代码；Demo 运行时访问 Jev 的代理在下一步用 `.env` 单独控制。

### 2. 配置 API Key

推荐使用 `.env`：

```bash
cp support-demo/env.example .env
# 编辑仓库根目录的 .env，填写 TYPESAFE_API_KEY
# 这一份 .env 同时被 tetris-demo 和 examples/ 共用
```

`.env` 已被 `.gitignore` 忽略，不会随 `git clone` 带到新机器，也不会被提交——每台机器都要单独创建。也可以直接在终端里设置：

```bash
export TYPESAFE_API_KEY="apikey_..."
```

> macOS 默认终端是 zsh。如果 Key 只写在 `~/.zshrc` 里，`start.sh` 不会主动读取它；请重新打开终端让变量导出，或直接使用 `.env`。可用 `echo ${TYPESAFE_API_KEY:+set}` 检查当前终端有没有该变量（只输出 `set`，不会打印 Key）。

`start.sh` 的 Key 读取顺序：

1. 已导出的 `TYPESAFE_API_KEY`
2. `~/.bash_profile` / `~/.profile` / `~/.bashrc` 中第一个能设置它的文件
3. 交互式提示输入（不回显、不落盘）
4. 仓库根目录的 `.env`（由 `server.py` 自己加载）

### 3. 启动

```bash
bash support-demo/start.sh
```

启动后打开：

```text
http://127.0.0.1:8787
```

> 不要直接双击 `support-demo/index.html`。`file://` 页面无法请求本地的 `/api/*`，必须通过 `start.sh` 启动的服务打开。

快速确认服务是否正常：

```bash
curl -s http://127.0.0.1:8787/api/health | python3 -m json.tool
```

`/api/health` 只返回配置状态（模型、Key 是否配置、是否加载 `.env`、是否使用代理），不会返回 Key 本身。

### 4. 端口或代理有问题时

```bash
# 8787 被占用
PORT=9000 bash support-demo/start.sh

# 强制直连
TYPESAFE_PROXY="" bash support-demo/start.sh

# 指定代理
TYPESAFE_PROXY="http://127.0.0.1:7890" bash support-demo/start.sh
```

### Windows PowerShell

```powershell
git clone https://github.com/monkey-jz/jev_demo.git
cd jev_demo
Copy-Item support-demo\env.example .env
# 编辑仓库根目录的 .env，填写 TYPESAFE_API_KEY
python support-demo\server.py
```

如果系统里是 `py` 而不是 `python`：

```powershell
py -3 support-demo\server.py
```

`start.sh` 需要 Bash；在 Windows 原生 CMD / PowerShell 下直接运行 `server.py` 即可，它会读取仓库根目录的 `.env`。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `TYPESAFE_API_KEY` | 无 | 必填，只在服务端使用 |
| `TYPESAFE_PROXY` | 自动探测 | 显式代理地址；设为空字符串表示强制直连 |
| `HTTPS_PROXY` / `https_proxy` | 自动继承 | 标准代理环境变量；没有显式 `TYPESAFE_PROXY` 时使用 |
| `PORT` | `8787` | 本地服务端口 |
| `HOST` | `127.0.0.1` | 监听地址；默认只允许本机访问 |

代理探测顺序：

1. `TYPESAFE_PROXY`（显式设置优先，空值 = 直连）
2. `HTTPS_PROXY` / `https_proxy` / `HTTP_PROXY` / `http_proxy`
3. 本机 `127.0.0.1:7890`（ClashX 常见端口）
4. 直连

如果 API 返回 **HTTP 451**、连接超时或 `network error`，通常是当前网络无法直连，需要在仓库根目录的 `.env` 中设置：

```dotenv
TYPESAFE_PROXY=http://127.0.0.1:7890
```

### 用 curl 验证代理和 Key

```bash
# 直连
curl -sS -H "Authorization: Bearer $TYPESAFE_API_KEY" \
  https://api.jevgo.cn/v1/models

# 走代理
curl -sS --proxy http://127.0.0.1:7890 \
  -H "Authorization: Bearer $TYPESAFE_API_KEY" \
  https://api.jevgo.cn/v1/models
```

## 常见问题

| 现象 | 处理 |
|---|---|
| `Address already in use` / 端口被占用 | 停掉旧实例，或 `PORT=9000 bash support-demo/start.sh` |
| `TYPESAFE_API_KEY 未设置` | 检查 `.env` 是否填了 key，或 `export TYPESAFE_API_KEY=...` |
| HTTP 401 / 403 | Key 错误、失效，或账号没有该模型权限 |
| HTTP 451 / 超时 / network error | 设置 `TYPESAFE_PROXY`；确认代理程序已启动 |
| 页面能打开但对话不出现 | 打开浏览器控制台；检查 `/api/health` 和 `support-demo/server.py` 是否仍在运行 |
| `python3: command not found` | 安装 Python 3.8+，或改用 `python` / `py -3` |
| 端口不想暴露到局域网 | 保持 `HOST=127.0.0.1`；只有明确需要远程访问时才改 `0.0.0.0`，并加网络隔离 |
| Windows 无法运行 `start.sh` | 用 PowerShell 手动运行 `python support-demo\server.py`，或使用 WSL / Git Bash |

> 每次点击都会真实调用 Jev，并产生 token 费用。快捷回答按钮只是帮演示者快速走完整条链路。

> 如果使用 Docker、远程开发机或虚拟机：默认 `127.0.0.1` 只在容器 / 虚拟机内部可见，需要在宿主机做端口转发；改成 `HOST=0.0.0.0` 会把这个未加认证的 Demo 暴露给同网段，必须确保网络可信。

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
├── start.sh      # 读取环境变量 / 提示输入并启动服务
├── env.example   # 复制为仓库根目录的 .env 后填写 Key；.env 不会被提交
├── index.html    # 对话界面、诊断侧栏、API 原始请求 / 响应查看器
├── server.py     # 静态页 + Jev 代理 + 阶段定义 + 规则守卫
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

> 安全提醒：仓库里的 `jev-internal-share.md` 按之前的要求保留了历史演示 Key。换机器演示时，建议使用单独或可轮换的 Key，并确保 `support-demo/.env` 不被提交；如果这个仓库是公开的，任何出现在仓库里的 Key 都应视为已暴露。
