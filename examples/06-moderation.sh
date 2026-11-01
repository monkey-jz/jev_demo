#!/usr/bin/env bash
# 示例 6 · 内容审核（2 × noul + score）
# 独立脚本：只发送这一个示例，不依赖 jev-demo-all.sh。
#
# 前置：
#   source ~/.bash_profile        # 或 export TYPESAFE_API_KEY
#   PROXY=http://127.0.0.1:7890   # 默认；直连可用时 PROXY=""
#
# 运行：
#   bash examples/06-moderation.sh
#
# 首次运行参考：spam 0.98 / insult 0.98 / severity 2.0（527/53 tokens）
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
  "state": {
    "comment": "你这个蠢货，赶紧加我买课，今天付款半价！",
    "policy": {
      "spam": "未经请求推销商品、课程或服务，包含引导联系或付款的内容",
      "insult": "直接针对个人的贬低、辱骂或人身攻击；单纯批评产品不算"
    }
  },
  "questions": {
    "is_spam": {
      "type": "noul",
      "instructions": "依据 `policy.spam`，`comment` 是否包含广告推销？"
    },
    "is_insult": {
      "type": "noul",
      "instructions": "依据 `policy.insult`，`comment` 是否包含针对个人的辱骂？"
    },
    "severity": {
      "type": "score",
      "instructions": "依据 `policy`，`comment` 的违规程度如何？",
      "criteria": [
        "没有违反所给规则",
        "存在隐晦的推销或轻微的人身贬低，违规程度较轻",
        "存在直接引导购买或付款的广告，或明确的针对个人的辱骂"
      ]
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

echo "===== 示例 6 · 内容审核（2 × noul + score） ====="
echo "----- 请求参数（model / state / questions）-----"
python3 -m json.tool --no-ensure-ascii "$req" 2>/dev/null || cat "$req"
echo "----- 响应 -----"
code=$(curl "${args[@]}")
echo "HTTP $code"
python3 -m json.tool --no-ensure-ascii "$resp" 2>/dev/null || cat "$resp"
