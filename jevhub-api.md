# JevHub · Jev API 完整接口文档

> 与 TypeSafe 官方 System One 接口同路径、同格式。只需把地址换成 `https://api.jevgo.cn`、Key 换成本站的 `sk-jh-...`。
> 在线版：https://api.jevgo.cn/docs　　给 AI Agent 的说明：https://api.jevgo.cn/skill.md

## 目录

1. 基础信息
2. 鉴权
3. POST /v1/systemone（提问）
4. 四种问题类型与返回
5. 图片与长上下文
6. GET /v1/models（模型列表）
7. 请求限制
8. 错误码与重试
9. 计费
10. 完整示例（curl / Python / Node.js）
11. 使用建议

---

## 1. 基础信息

| 项 | 值 |
| --- | --- |
| Base URL | `https://api.jevgo.cn` |
| 提问接口 | `POST https://api.jevgo.cn/v1/systemone` |
| 模型列表 | `GET https://api.jevgo.cn/v1/models` |
| 默认模型 | `jev-latest`（别名，自动跟随官方最新版本） |
| 数据格式 | 请求、响应均为 UTF-8 JSON |

## 2. 鉴权

每个请求带请求头：

```
Authorization: Bearer sk-jh-xxxxxxxx
Content-Type: application/json
```

Key 在站内「余额」页查看和重置。重置后旧 Key 立即失效。**Key 只放环境变量（如 `JEVHUB_API_KEY`），不要写进代码或提交记录。**

可选请求头 `X-JevHub-Client`：标记你的调用来源（如 `api`、你的应用名），本站据此分来源统计调用量；经 Skill 调用时固定为 `skill`。不带则记为未标记，不影响功能。

## 3. POST /v1/systemone

对 `state` 里的内容同时回答一个或多个问题。答案按你起的问题名返回。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 模型名或别名，一般用 `jev-latest` |
| `state` | string / object / array | 是 | 所有问题都针对的内容。多部分内容建议用具名 JSON 字段 |
| `questions` | object | 是 | 至少 1 个。键是你起的问题名（只给代码用，不发给模型），值是问题对象 |
| `assets` | object | 否 | 图片资源，见第 5 节 |

问题对象公共字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | `noul` / `choice` / `score` / `box` |
| `instructions` | string / object / array | 要模型判断什么。可以是一句话，也可以是结构化 JSON |
| `criteria` | 视类型而定 | 选项、等级或是非标准，见第 4 节 |

### 响应体

```json
{
  "model": "jev-1.13",
  "answers": {
    "<问题名>": { "type": "noul", "noul": 0.98 }
  }
}
```

- `model`：实际作答的模型，可能和请求里的别名不同。
- 本站响应不含 `usage` 字段。
- 响应头 `X-JevHub-Charge-USD`：本次扣减的额度（美元）。

## 4. 四种问题类型与返回

### noul：是 / 否

```json
"billing": {
  "type": "noul",
  "instructions": "这条消息和账单有关吗？",
  "criteria": { "true": "涉及扣费、退款、发票", "false": "其他话题" }
}
```

`criteria` 可省略，用来说明什么算「是」、什么算「否」。

返回：`{"type": "noul", "noul": 0.98}`。`noul` 是「是 / 为真」的概率，0–1；接近 0.5 表示不确定。noul 没有 confidence。

### choice：多选一

```json
"tone": {
  "type": "choice",
  "instructions": "这条消息的语气是？",
  "criteria": { "angry": "生气或敌意", "calm": "平静或礼貌", "other": "都不是" }
}
```

`criteria` 必填，1–255 个选项，键是选项名，值是什么时候选它（可为空，空则只看名字）。

返回：

```json
{ "type": "choice", "choice": "calm", "confidence": 0.7,
  "probabilities": { "angry": 0.15, "calm": 0.8, "other": 0.05 } }
```

### score：按等级打分

```json
"urgency": {
  "type": "score",
  "instructions": "这条消息有多紧急？",
  "criteria": ["可以等", "本周内处理", "今天必须处理"]
}
```

`criteria` 必填，1–10 个**有序**等级，位置就是分值（从 0 开始）。

返回：

```json
{ "type": "score", "score": 1.7, "confidence": 0.55,
  "legend": { "0": "可以等", "1": "本周内处理", "2": "今天必须处理" },
  "probabilities": { "0": 0.1, "1": 0.1, "2": 0.8 } }
```

`score` 是按概率加权的期望分，可能落在两个整数之间。

### box：在图片里框出位置

```json
"red_rectangle": { "type": "box", "instructions": "找出红色矩形" }
```

需要图片（第 5 节）。返回四条边占图片宽高的比例（0–1，上、左为 0）：

```json
{ "type": "box", "box": { "top": 0.2, "bottom": 0.66, "left": 0.19, "right": 0.68 }, "confidence": null }
```

## 5. 图片与长上下文

**图片**：请求头加 `TypeSafe-Danger-Zone-Images: true`，在 `assets` 里放 base64 图片，用占位符在 `state`、`instructions` 或 `criteria` 里引用：

```json
{
  "model": "jev-latest",
  "state": "IMG_7f3a",
  "assets": { "IMG_7f3a": { "type": "image", "format": "png", "data_base64": "iVBORw0..." } },
  "questions": { "has_cat": { "type": "noul", "instructions": "图里有猫吗？" } }
}
```

`format` 支持 `png` / `jpg` / `jpeg`。图片能力需要支持视觉的模型，以 `GET /v1/models` 为准。本站只接受 JSON 请求，不支持 multipart 上传。

**图片尺寸（硬性限制，超限返回 400 `Invalid image dimensions`）**：每边 280–1568 像素，总像素 78,400–2,458,624，单张文件不超过 16 MB（base64 按解码后算）。官方不会自动缩放，发送前先处理到范围内：全屏截图（如 1920×1080）原图直接发会被拒，先把最长边缩到 1568 以内；每边小于 280 的小图先放大或补边。只收静止图片，动图和 GIF / WebP / HEIC 先转成 PNG 或 JPEG。

**长上下文**：请求头加 `TypeSafe-Danger-Zone-Long-Context: true` 可放更长的内容（超长返回 400 `max_tokens_exceeded`）。

这两个请求头本站会原样转给官方。

## 6. GET /v1/models

```bash
curl https://api.jevgo.cn/v1/models -H "Authorization: Bearer $JEVHUB_API_KEY"
```

返回当前可用的模型名和别名。不扣额度。

## 7. 请求限制

| 项 | 本站限制 |
| --- | --- |
| 请求体 | 最大 4 MB（含 base64 图片；超出返回 413） |
| 编码 | UTF-8 JSON，不带 BOM |
| 嵌套 | `state`、`instructions`、`criteria` 各自最多 64 层 |
| 数字 | 只接受有限数字；ID 和超大数值请用字符串 |
| 压缩 | 支持 `Content-Encoding: gzip` / `zstd`，只能一层 |
| 频率 | 每个 Key 默认每秒 5 次、同时 4 个请求；超出返回 429 |

## 8. 错误码与重试

本站自身的错误返回 `{"detail": "说明", "code": "错误代码"}`；官方的错误（如 422）原样返回。

| 状态码 | 含义 | 怎么办 |
| --- | --- | --- |
| 400 | 请求不合规（非法 UTF-8、嵌套太深、内容超长 `max_tokens_exceeded`、图片尺寸不在 280–1568 像素内 `Invalid image dimensions`） | 修正后再发，不要重试；图片先缩放（见第 5 节） |
| 401 | 缺少或无效的 Key | 检查 `Authorization: Bearer sk-jh-...` |
| 402 | 额度用完或套餐到期 | 到 https://api.jevgo.cn/redeem 兑换新卡密 |
| 403 | 账号被封禁 | 联系卖家 |
| 413 | 请求体太大 | 压缩图片或拆分内容 |
| 415 | 压缩格式不支持 | 只用 gzip 或 zstd 一层 |
| 422 | 字段校验失败 | 看 `detail[].loc` 定位字段，修正后再发 |
| 429 | 超过频率或并发限制 | 指数退避重试 |
| 502 / 529 | 上游繁忙或线路异常（本站已自动换线） | 指数退避重试 |

推荐重试：只对 429 / 502 / 529 重试，等待 1s、2s、4s、8s…（加一点随机抖动），最多 5 次。

## 9. 计费

- 按本站计费标准从你的额度（美元）扣减，失败请求（4xx / 5xx）不扣。
- 每次扣了多少：响应头 `X-JevHub-Charge-USD`，或站内「余额 → 调用明细」。
- 额度和有效期以兑换的套餐为准，到期后剩余额度清零；续费兑换会顺延有效期、额度累加。

## 10. 完整示例

### curl

```bash
export JEVHUB_API_KEY="sk-jh-..."
curl https://api.jevgo.cn/v1/systemone \
  -H "Authorization: Bearer $JEVHUB_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jev-latest",
    "state": "我这个月被重复扣费了，请把多扣的退给我。",
    "questions": {
      "billing": { "type": "noul", "instructions": "这条消息和账单有关吗？" },
      "tone": { "type": "choice", "instructions": "语气是？",
                "criteria": { "angry": "生气", "calm": "平静", "other": "都不是" } },
      "urgency": { "type": "score", "instructions": "有多紧急？",
                   "criteria": ["可以等", "本周内处理", "今天必须处理"] }
    }
  }'
```

### Python（requests，带重试）

```python
import os, random, time, requests

BASE_URL = "https://api.jevgo.cn"
API_KEY = os.environ["JEVHUB_API_KEY"]

def ask(state, questions, model="jev-latest", retries=5):
    for i in range(retries):
        r = requests.post(
            f"{BASE_URL}/v1/systemone",
            headers={"Authorization": f"Bearer {API_KEY}"},
            json={"model": model, "state": state, "questions": questions},
            timeout=30,
        )
        if r.status_code in (429, 502, 529) and i < retries - 1:
            time.sleep(2 ** i + random.random())
            continue
        r.raise_for_status()
        return r.json()["answers"]

answers = ask(
    {"subject": "重复扣费", "message": "我被扣了两次，请退款"},
    {"billing": {"type": "noul", "instructions": "这条消息和账单有关吗？"}},
)
print(answers["billing"]["noul"])
```

### Node.js（fetch，Node 18+）

```js
const BASE_URL = "https://api.jevgo.cn";
const API_KEY = process.env.JEVHUB_API_KEY;

async function ask(state, questions, model = "jev-latest") {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${BASE_URL}/v1/systemone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, state, questions }),
    });
    if ([429, 502, 529].includes(r.status) && i < 4) {
      await new Promise((ok) => setTimeout(ok, 2 ** i * 1000 + Math.random() * 300));
      continue;
    }
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return (await r.json()).answers;
  }
}

ask("物流三天没动了", { logistics: { type: "noul", instructions: "这是物流问题吗？" } })
  .then((a) => console.log(a.logistics.noul));
```

> 本站响应不含 `usage` 字段，官方 SDK 会因此报错，请直接用 HTTP 调用。

## 11. 使用建议

1. 一个问题只做一个窄而明确的判断；多个独立问题放进同一次请求，并行回答，更快也更省。
2. 给足 `state` 上下文；多部分内容用具名 JSON 字段，问题里用反引号引用，如 `ticket.subject`。
3. choice 一定加一个「都不是 / 无法判断」的兜底选项。
4. 用概率和 confidence 决定代码行为，阈值在真实数据上调；低置信度交给人工或更强的模型。
5. 规则、计算、精确查找留在代码里，Jev 只负责需要语义理解的那一步。

更多概念与案例见官方文档：https://docs.typesafe.ai
