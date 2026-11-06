#!/usr/bin/env bash
# 示例 8 · 商品去重（score + 2 × noul）
# 独立脚本：只发送这一个示例，不依赖 jev-demo-all.sh。
#
# 前置：key 默认从仓库根目录的 .env 读取（无需 export）。
#   PROXY=http://127.0.0.1:7890   # 可选；留空则自动探测本机 7890
#
# 运行：
#   bash examples/08-product-dedup.sh
#
# 首次运行参考：match 2.0 / names 0.94 / conflict 0.05（608/55 tokens）
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
    "entity_type": "product",
    "entity_a": {
      "name": "Acme Air 无线耳机 白色",
      "brand": "Acme",
      "model": "AIR-2",
      "spec": "白色，单副装"
    },
    "entity_b": {
      "name": "ACME Air 第二代耳机 / White",
      "brand": "ACME",
      "model": "AIR-2",
      "spec": "白色，1 副"
    }
  },
  "questions": {
    "match_strength": {
      "type": "score",
      "instructions": "综合名称、品牌、型号和规格，`entity_a` 与 `entity_b` 在多大程度上描述同一商品及规格？",
      "criteria": [
        "有明确证据表明是不同商品或不同规格",
        "商品相关，但关键信息缺失或含糊，无法确认相同",
        "关键信息一致，名称差异可解释为别名、语言或写法差异"
      ]
    },
    "names_equivalent": {
      "type": "noul",
      "instructions": "结合品牌、型号与规格，`entity_a.name` 与 `entity_b.name` 是否是同一商品名称的不同表述？"
    },
    "spec_conflict": {
      "type": "noul",
      "instructions": "`entity_a.spec` 与 `entity_b.spec` 是否在颜色、容量或包装数量上存在明确冲突？"
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

echo "===== 示例 8 · 商品去重（score + 2 × noul） ====="
echo "----- 请求参数（model / state / questions）-----"
python3 -m json.tool --no-ensure-ascii "$req" 2>/dev/null || cat "$req"
echo "----- 响应 -----"
code=$(curl "${args[@]}")
echo "HTTP $code"
python3 -m json.tool --no-ensure-ascii "$resp" 2>/dev/null || cat "$resp"
