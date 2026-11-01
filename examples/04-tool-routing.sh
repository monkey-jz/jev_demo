#!/usr/bin/env bash
# 示例 4 · AI 助手选择工具（2 × choice）
# 独立脚本：只发送这一个示例，不依赖 jev-demo-all.sh。
#
# 前置：
#   source ~/.bash_profile        # 或 export TYPESAFE_API_KEY
#   PROXY=http://127.0.0.1:7890   # 默认；直连可用时 PROXY=""
#
# 运行：
#   bash examples/04-tool-routing.sh
#
# 首次运行参考：check_calendar / tomorrow_afternoon（652/94 tokens）
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
    "message": "帮我看看明天下午有没有空。",
    "current_date": "2026-11-01",
    "timezone": "Asia/Shanghai",
    "available_tools": {
      "check_calendar": "查询当前登录用户的日历空闲时间",
      "search_docs": "搜索已有知识库文档"
    }
  },
  "questions": {
    "tool": {
      "type": "choice",
      "instructions": "`message` 最适合由 `available_tools` 中哪个工具处理？",
      "criteria": {
        "check_calendar": "需要查询用户日历、已有安排或空闲时间",
        "search_docs": "需要搜索知识库中的资料或说明",
        "unsupported": "现有工具都不适用，或无法确定所需操作"
      }
    },
    "calendar_window": {
      "type": "choice",
      "instructions": "如果 `message` 请求查询日历，其表达的查询时间属于哪一项？相对日期以 `current_date` 和 `timezone` 为准。",
      "criteria": {
        "today_afternoon": "当前日期的下午，13:00 至 18:00",
        "tomorrow_afternoon": "当前日期后一个自然日的下午，13:00 至 18:00",
        "other_or_unspecified": "其他时间、时间缺失，或不是日历查询"
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

echo "===== 示例 4 · AI 助手选择工具（2 × choice） ====="
echo "----- 请求参数（model / state / questions）-----"
python3 -m json.tool --no-ensure-ascii "$req" 2>/dev/null || cat "$req"
echo "----- 响应 -----"
code=$(curl "${args[@]}")
echo "HTTP $code"
python3 -m json.tool --no-ensure-ascii "$resp" 2>/dev/null || cat "$resp"
