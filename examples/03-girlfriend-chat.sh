#!/usr/bin/env bash
# 示例 3 · 女朋友聊天（noul + score + choice；潜台词选项为补写）
# 独立脚本：只发送这一个示例，不依赖 jev-demo-all.sh。
#
# 前置：
#   source ~/.bash_profile        # 或 export TYPESAFE_API_KEY
#   PROXY=http://127.0.0.1:7890   # 默认；直连可用时 PROXY=""
#
# 运行：
#   bash examples/03-girlfriend-chat.sh
#
# 首次运行参考：不满 0.91 / 程度 1.96 / 潜台词 A 90%（615/82 tokens）
# 注意：潜台词选项为截图补写，复跑概率会波动。
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
    "背景": "女朋友想聊天，男朋友却一直在玩游戏。",
    "聊天记录": [
      "女朋友：今天工作好烦啊。",
      "男朋友：嗯。",
      "女朋友：算了，你忙吧，我不打扰你了。"
    ]
  },
  "questions": {
    "是否不满": {
      "type": "noul",
      "instructions": "女朋友是否在表达不满？",
      "criteria": {
        "true": "对男朋友敷衍的回复感到不满",
        "false": "没有明显表达不满"
      }
    },
    "不满程度": {
      "type": "score",
      "instructions": "评估女朋友表达不满的程度。",
      "criteria": [
        "没有明显不满",
        "有些不满，但情绪比较平和",
        "明显不满，对男朋友的态度感到失望",
        "非常不满，明确表达愤怒"
      ]
    },
    "潜台词": {
      "type": "choice",
      "instructions": "女朋友说「算了，你忙吧，我不打扰你了」，最可能的潜台词是什么？",
      "criteria": {
        "A": "希望男朋友放下游戏，认真陪自己聊天",
        "B": "准备冷战，暂时不想理男朋友",
        "C": "只是在陈述工作烦恼，没有别的意思",
        "D": "想结束对话，去忙自己的事"
      }
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

echo "===== 示例 3 · 女朋友聊天（noul + score + choice；潜台词选项为补写） ====="
echo "----- 请求参数（model / state / questions）-----"
python3 -m json.tool --no-ensure-ascii "$req" 2>/dev/null || cat "$req"
echo "----- 响应 -----"
code=$(curl "${args[@]}")
echo "HTTP $code"
python3 -m json.tool --no-ensure-ascii "$resp" 2>/dev/null || cat "$resp"
