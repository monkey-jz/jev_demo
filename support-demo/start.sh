#!/usr/bin/env bash
# Start the sleep-bracelet triage demo.
#   bash support-demo/start.sh
#
# Key resolution order:
#   1. TYPESAFE_API_KEY already exported
#   2. the first of ~/.bash_profile, ~/.profile, ~/.bashrc that sets it
#   3. an interactive prompt (the key is not echoed or written to disk)
#   4. support-demo/.env, which server.py loads itself
set -euo pipefail

cd "$(dirname "$0")"
ENV_FILE="$PWD/.env"

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
  echo "  1) cp support-demo/env.example support-demo/.env   # 在仓库根目录" >&2
  echo "     然后编辑 support-demo/.env，填入 key" >&2
  echo "  2) export TYPESAFE_API_KEY=\"...\" && bash support-demo/start.sh" >&2
  exit 1
fi

if [ -n "${TYPESAFE_API_KEY:-}" ]; then
  export TYPESAFE_API_KEY
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "未找到 python3。请安装 Python 3.8+，或确认它已在 PATH 中。" >&2
  exit 1
fi

exec python3 server.py
