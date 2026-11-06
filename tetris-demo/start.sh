#!/usr/bin/env bash
# Start the Jev Tetris demo.
#   bash tetris-demo/start.sh
#
# Key resolution order:
#   1. TYPESAFE_API_KEY already exported
#   2. the first of ~/.bash_profile, ~/.profile, ~/.bashrc that sets it
#   3. an interactive prompt (the key is not echoed or written to disk)
#   4. the repo-root .env, which server.py loads itself
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"
ENV_FILE="$(cd "$SCRIPT_DIR/.." && pwd)/.env"   # 共享 key 文件在仓库根目录

if [ -z "${TYPESAFE_API_KEY:-}" ]; then
  for profile in "$HOME/.bash_profile" "$HOME/.profile" "$HOME/.bashrc"; do
    [ -f "$profile" ] || continue
    # shellcheck disable=SC1090
    source "$profile" >/dev/null 2>&1 || true
    if [ -n "${TYPESAFE_API_KEY:-}" ]; then
      break
    fi
  done
fi

if [ -z "${TYPESAFE_API_KEY:-}" ] && [ ! -f "$ENV_FILE" ] && [ -t 0 ]; then
  printf "输入 TYPESAFE_API_KEY（输入不会回显）: " >&2
  IFS= read -r -s TYPESAFE_API_KEY || true
  printf "\n" >&2
fi

if [ -z "${TYPESAFE_API_KEY:-}" ] && [ ! -f "$ENV_FILE" ]; then
  echo "未找到 TYPESAFE_API_KEY。任选一种方式：" >&2
  echo "  1) cp tetris-demo/env.example .env   # 在仓库根目录创建唯一的 key 文件" >&2
  echo "     然后编辑根目录 .env，填入 key（所有 demo 共用）" >&2
  echo "  2) export TYPESAFE_API_KEY=\"...\" && bash tetris-demo/start.sh" >&2
  exit 1
fi

if [ -n "${TYPESAFE_API_KEY:-}" ]; then
  export TYPESAFE_API_KEY
fi

# A sourced shell profile may have changed the working directory.
cd "$SCRIPT_DIR"

if ! command -v python3 >/dev/null 2>&1; then
  echo "未找到 python3。请安装 Python 3.8+，或确认它已在 PATH 中。" >&2
  exit 1
fi

exec python3 "$SCRIPT_DIR/server.py"
