# Jev Demo

本仓库包含一个可交互的“睡眠手环排障台”，以及 Jev / TypeSafe 的学习资料和 API 示例。

## 睡眠手环排障台（推荐演示）

用户购买睡眠手环，佩戴一晚后，第二天 App 里没有睡眠数据。页面通过六轮对话收集证据，每一步真实调用一次 Jev，最后一轮结合全部证据判断主因，并路由到：

- 用户侧：佩戴方式、电量
- 客服侧：蓝牙同步、App 权限 / 账号、数据不足、人工复核
- 研发 / 质量侧：硬件或固件故障

完整说明见 **[support-demo/README.md](support-demo/README.md)**。

### 另一台电脑快速启动

前置条件：Python 3.8+、可用的 `TYPESAFE_API_KEY`、能访问 `https://api.typesafe.ai`。

```bash
git clone https://github.com/monkey-jz/jev_demo.git
cd jev_demo

# 每台机器单独创建；.env 不会从 GitHub 拉取
cp support-demo/env.example support-demo/.env
# 编辑 support-demo/.env，填写 TYPESAFE_API_KEY

bash support-demo/start.sh
```

打开 <http://127.0.0.1:8787>。健康检查：

```bash
curl -s http://127.0.0.1:8787/api/health | python3 -m json.tool
```

- 不要直接双击 `support-demo/index.html`，必须通过本地服务打开。
- 8787 被占用时：`PORT=9000 bash support-demo/start.sh`。
- 网络需要代理时，在 `.env` 里设置 `TYPESAFE_PROXY=http://127.0.0.1:7890`（替换成实际地址）。
- Windows 请用 PowerShell 运行 `python support-demo\server.py`，并先创建 `support-demo\.env`。
- `git clone` 超时通常是 GitHub 网络问题，与 Demo 的 Jev 代理是两回事，详见 `support-demo/README.md`。

## 其他内容

| 路径 | 内容 |
|---|---|
| `support-demo/` | 睡眠手环交互式排障台（HTML + Python 本地代理） |
| `jev-internal-share.md` | Jev 概念、环境配置、使用方式和示例的内部分享 |
| `jev-demo-all.sh` | 批量运行 API 示例的脚本 |
| `examples/01`–`09` | 每个示例的独立脚本 |

## 安全提醒

按之前的要求，`jev-internal-share.md` 保留了历史演示 Key。这个仓库是公开的，任何提交进仓库的 Key 都应视为已暴露；换机器演示时建议使用单独或可轮换的 Key，并确保 `support-demo/.env` 不被提交。
