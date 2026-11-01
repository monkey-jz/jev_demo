#!/usr/bin/env bash
# 示例 5 · 搜索结果排序（3 × score，同一标准）
# 独立脚本：只发送这一个示例，不依赖 jev-demo-all.sh。
#
# 前置：
#   source ~/.bash_profile        # 或 export TYPESAFE_API_KEY
#   PROXY=http://127.0.0.1:7890   # 默认；直连可用时 PROXY=""
#
# 运行：
#   bash examples/05-search-ranking.sh
#
# 首次运行参考：d1 2.60 / d2 0.47 / d3 0.01（749/55 tokens；复跑会波动）
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
    "query": "如何在 Windows PowerShell 中给 Jev 发送 JSON 请求？",
    "candidates": [
      {
        "id": "d1",
        "text": "在 PowerShell 中使用 curl.exe，通过 --data-binary 提交 UTF-8 无 BOM 的 JSON 文件，并设置 Authorization 和 Content-Type。"
      },
      {
        "id": "d2",
        "text": "本文介绍如何创建 TypeSafe 账号和 API Key。"
      },
      {
        "id": "d3",
        "text": "本文介绍咖啡机的安装与日常保养。"
      }
    ]
  },
  "questions": {
    "relevance_d1": {
      "type": "score",
      "instructions": "`candidates[0].text` 在多大程度上直接回答 `query`？",
      "criteria": [
        "内容无关",
        "主题相关，但未提供问题所需信息",
        "提供部分所需信息，仍有关键缺失",
        "直接提供回答问题所需的核心信息"
      ]
    },
    "relevance_d2": {
      "type": "score",
      "instructions": "`candidates[1].text` 在多大程度上直接回答 `query`？",
      "criteria": [
        "内容无关",
        "主题相关，但未提供问题所需信息",
        "提供部分所需信息，仍有关键缺失",
        "直接提供回答问题所需的核心信息"
      ]
    },
    "relevance_d3": {
      "type": "score",
      "instructions": "`candidates[2].text` 在多大程度上直接回答 `query`？",
      "criteria": [
        "内容无关",
        "主题相关，但未提供问题所需信息",
        "提供部分所需信息，仍有关键缺失",
        "直接提供回答问题所需的核心信息"
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

echo "===== 示例 5 · 搜索结果排序（3 × score，同一标准） ====="
echo "----- 请求参数（model / state / questions）-----"
python3 -m json.tool --no-ensure-ascii "$req" 2>/dev/null || cat "$req"
echo "----- 响应 -----"
code=$(curl "${args[@]}")
echo "HTTP $code"
python3 -m json.tool --no-ensure-ascii "$resp" 2>/dev/null || cat "$resp"
