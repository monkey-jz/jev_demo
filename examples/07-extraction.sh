#!/usr/bin/env bash
# 示例 7 · 信息提取（choice + noul）
# 独立脚本：只发送这一个示例，不依赖 jev-demo-all.sh。
#
# 前置：
#   source ~/.bash_profile        # 或 export TYPESAFE_API_KEY
#   PROXY=http://127.0.0.1:7890   # 默认；直连可用时 PROXY=""
#
# 运行：
#   bash examples/07-extraction.sh
#
# 首次运行参考：c3 / has_payable_amount 0.99（562/71 tokens）
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
    "document": "商品原价 ¥1,200.00，优惠 ¥200.00，本次应付 ¥1,000.00。请按应付金额付款。",
    "candidates": {
      "c1": "¥1,200.00",
      "c2": "¥200.00",
      "c3": "¥1,000.00"
    }
  },
  "questions": {
    "payable_candidate": {
      "type": "choice",
      "instructions": "`candidates` 中哪个候选是 `document` 明确要求本次支付的应付金额？",
      "criteria": {
        "c1": "选择 `candidates.c1` 的原文金额",
        "c2": "选择 `candidates.c2` 的原文金额",
        "c3": "选择 `candidates.c3` 的原文金额",
        "none": "没有候选对应原文明确给出的应付金额"
      }
    },
    "has_payable_amount": {
      "type": "noul",
      "instructions": "`document` 是否明确给出了本次应付金额，而非仅给出原价或优惠额？"
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

echo "===== 示例 7 · 信息提取（choice + noul） ====="
echo "----- 请求参数（model / state / questions）-----"
python3 -m json.tool --no-ensure-ascii "$req" 2>/dev/null || cat "$req"
echo "----- 响应 -----"
code=$(curl "${args[@]}")
echo "HTTP $code"
python3 -m json.tool --no-ensure-ascii "$resp" 2>/dev/null || cat "$resp"
