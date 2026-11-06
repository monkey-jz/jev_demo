#!/usr/bin/env bash
# 共享的 .env 加载器。examples/ 和 jev-demo-all.sh 都 source 这个文件。
#
# 规则：
#   - 只从仓库根目录的 .env 读取，未知变量不会污染当前 shell 之外的进程；
#   - 已经 export 的变量优先，.env 只补空缺（与 server.py 的行为一致）；
#   - 找不到 .env 时不报错，由调用方决定怎么提示。
#
# 用法（在脚本里）：
#   ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
#   source "$ROOT_DIR/load-env.sh"

JEV_ROOT_DIR="${JEV_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
JEV_ENV_FILE="${JEV_ENV_FILE:-$JEV_ROOT_DIR/.env}"

if [ -f "$JEV_ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    case "$line" in
      ''|'#'*) continue ;;
    esac
    line="${line#export }"
    case "$line" in
      *=*) ;;
      *) continue ;;
    esac
    name="${line%%=*}"
    value="${line#*=}"
    name="${name%"${name##*[![:space:]]}"}"
    case "$name" in
      ''|[0-9]*|*[!A-Za-z0-9_]*) continue ;;
    esac
    # 去掉首尾空白
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    # 去掉成对的引号
    case "$value" in
      \"*\") value="${value#\"}" ; value="${value%\"}" ;;
      \'*\') value="${value#\'}" ; value="${value%\'}" ;;
    esac
    # 已 export 的优先，只补空缺
    if [ -z "$(printenv "$name")" ]; then
      export "$name=$value"
    fi
  done < "$JEV_ENV_FILE"
fi
