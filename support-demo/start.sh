#!/usr/bin/env bash
# Start the sleep-bracelet triage demo.
#   bash support-demo/start.sh
# The API key is read from TYPESAFE_API_KEY; if it is not set, try ~/.bash_profile.
set -euo pipefail

cd "$(dirname "$0")"

if [ -z "${TYPESAFE_API_KEY:-}" ] && [ -f "${HOME}/.bash_profile" ]; then
  # shellcheck disable=SC1090
  source "${HOME}/.bash_profile" || true
fi

if [ -z "${TYPESAFE_API_KEY:-}" ]; then
  echo "TYPESAFE_API_KEY 未设置。" >&2
  echo "请先 export，或把配置放进 ~/.bash_profile。" >&2
  exit 1
fi

exec python3 server.py
