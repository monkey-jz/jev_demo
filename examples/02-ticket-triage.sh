#!/usr/bin/env bash
# 示例 2 · 工单分流（choice + score + choice + noul）
# 独立脚本：只发送这一个示例，不依赖 jev-demo-all.sh。
#
# 前置：key 默认从仓库根目录的 .env 读取（无需 export）。
#   PROXY=http://127.0.0.1:7890   # 可选；留空则自动探测本机 7890
#
# 运行：
#   bash examples/02-ticket-triage.sh
#
# 首次运行参考：technical / 2.0 / frustrated / 0.96（677/120 tokens）
#
# 说明：模型输出有随机性，参考值不是固定结果；真实调用会产生 token 费用。

set -u

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/../load-env.sh"

PROXY="${PROXY-}"
URL="${JEV_API_URL:-https://api.jevgo.cn/v1/systemone}"

if [ -z "${TYPESAFE_API_KEY:-}" ]; then
  echo "TYPESAFE_API_KEY 未设置。在仓库根目录创建 .env 并填入：" >&2
  echo "  TYPESAFE_API_KEY=sk-jh-..." >&2
  echo "或临时： export TYPESAFE_API_KEY=\"...\"" >&2
  exit 1
fi

req=$(mktemp)
resp=$(mktemp)
trap 'rm -f "$req" "$resp"' EXIT

cat > "$req" <<'JSON'
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
JSON

args=(--silent --show-error
      --connect-timeout 10 --max-time 60
      -H "Authorization: Bearer $TYPESAFE_API_KEY"
      -H "Content-Type: application/json"
      --data-binary "@$req"
      -o "$resp" -w '%{http_code}'
      "$URL")
if [ -n "$PROXY" ]; then
  args=(--proxy "$PROXY" "${args[@]}")
fi

echo "===== 示例 2 · 工单分流（choice + score + choice + noul） ====="
echo "----- 请求参数（model / state / questions）-----"
python3 -m json.tool --no-ensure-ascii "$req" 2>/dev/null || cat "$req"
echo "----- 响应 -----"
code=$(curl "${args[@]}")
echo "HTTP $code"
python3 -m json.tool --no-ensure-ascii "$resp" 2>/dev/null || cat "$resp"
