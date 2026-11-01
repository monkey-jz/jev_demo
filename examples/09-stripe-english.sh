#!/usr/bin/env bash
# 示例 9 · 英文 Stripe 工单（noul，参考值 0.98）
# 独立脚本：只发送这一个示例，不依赖 jev-demo-all.sh。
#
# 前置：
#   source ~/.bash_profile        # 或 export TYPESAFE_API_KEY
#   PROXY=http://127.0.0.1:7890   # 默认；直连可用时 PROXY=""
#
# 运行：
#   bash examples/09-stripe-english.sh
#
# 首次运行参考：urgency 0.98（302/21 tokens）
#
# 说明：模型输出有随机性，参考值不是固定结果；真实调用会产生 token 费用。

set -u

PROXY="${PROXY-http://127.0.0.1:7890}"
URL="https://api.typesafe.ai/v1/systemone"

if [ -z "${TYPESAFE_API_KEY:-}" ]; then
  echo "TYPESAFE_API_KEY 未设置。先执行： source ~/.bash_profile" >&2
  echo "或： export TYPESAFE_API_KEY=\"...\"" >&2
  exit 1
fi

req=$(mktemp)
resp=$(mktemp)
trap 'rm -f "$req" "$resp"' EXIT

cat > "$req" <<'JSON'
{
  "model": "jev-latest",
  "state": "Hi, I've been trying to connect my Stripe account for 3 days and the integration keeps failing. I'm losing sales. Please help ASAP.",
  "questions": {
    "urgency": {
      "type": "noul",
      "instructions": "Does this message express urgency?"
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

echo "===== 示例 9 · 英文 Stripe 工单（noul，参考值 0.98） ====="
echo "----- 请求参数（model / state / questions）-----"
python3 -m json.tool --no-ensure-ascii "$req" 2>/dev/null || cat "$req"
echo "----- 响应 -----"
code=$(curl "${args[@]}")
echo "HTTP $code"
python3 -m json.tool --no-ensure-ascii "$resp" 2>/dev/null || cat "$resp"
