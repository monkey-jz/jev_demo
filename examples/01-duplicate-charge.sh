#!/usr/bin/env bash
# 示例 1 · 重复扣费投诉（noul，参考值 0.96）
# 独立脚本：只发送这一个示例，不依赖 jev-demo-all.sh。
#
# 前置：key 默认从仓库根目录的 .env 读取（无需 export）。
#   PROXY=http://127.0.0.1:7890   # 可选；留空则自动探测本机 7890
#
# 运行：
#   bash examples/01-duplicate-charge.sh
#
# 首次运行参考：urgency ≈ 0.96（298/21 tokens）
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
  "state": "客户说：我被重复扣费了，请立刻解决！",
  "questions": {
    "urgency": {
      "type": "noul",
      "instructions": "这条消息是否表达了紧急情绪？"
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

echo "===== 示例 1 · 重复扣费投诉（noul，参考值 0.96） ====="
echo "----- 请求参数（model / state / questions）-----"
python3 -m json.tool --no-ensure-ascii "$req" 2>/dev/null || cat "$req"
echo "----- 响应 -----"
code=$(curl "${args[@]}")
echo "HTTP $code"
python3 -m json.tool --no-ensure-ascii "$resp" 2>/dev/null || cat "$resp"
