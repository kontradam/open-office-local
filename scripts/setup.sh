#!/bin/sh
# Prepares a fresh checkout for `docker compose up`: compose file, data folders and the OpenCode config.
set -eu
cd "$(dirname "$0")/.."
[ -f docker-compose.yml ] || cp docker-compose.example.yml docker-compose.yml
mkdir -p data/home/.open-office/worktrees data/projects data/local-home/.config/opencode data/gpu-queue
[ -f data/local-home/.config/opencode/opencode.json ] || cp local/opencode.example.json data/local-home/.config/opencode/opencode.json
if [ "$(id -u)" = 0 ]; then
  chown -R 1000:1000 data
elif [ "$(id -u)" != 1000 ]; then
  echo "Note: the containers run as uid 1000. If the office cannot write to ./data, run: sudo chown -R 1000:1000 data"
fi
echo "Ready. Edit docker-compose.yml if needed, then: docker compose up -d --build"
