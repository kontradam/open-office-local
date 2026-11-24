#!/bin/sh
# Runs the main gateway (WS_PORT) and one gateway per project tab (PROJECT_PORTS) in one container.
# Each port keeps its own state in ~/.open-office/data/instances/port-N; logins and files are shared.
# Project tabs accept the main office owner token (MAIN_OFFICE_TOKENS), so you pair only once.
MAIN=${WS_PORT:-9090}
export MULTI_INSTANCE=1
rm -f "$HOME"/.open-office/data/instances/port-*/runtime.json "$HOME"/.open-office/data/instances/.locks/port-*.pid
export MAIN_OFFICE_TOKENS="$HOME/.open-office/data/instances/port-$MAIN/session-tokens.json"
for p in $PROJECT_PORTS; do
  ( while true; do
      rm -f "$HOME/.open-office/data/instances/port-$p/runtime.json" "$HOME/.open-office/data/instances/.locks/port-$p.pid"
      WS_PORT=$p PREVIEW_PORT=$((p + 1000)) pnpm start >/dev/null 2>&1
      echo "start-tabs: gateway :$p exited, restarting in 5 s"; sleep 5
    done ) &
done
exec env WS_PORT=$MAIN PREVIEW_PORT=$((MAIN + 1000)) pnpm start
