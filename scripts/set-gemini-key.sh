#!/bin/bash
# Reads a Gemini API key without echo, checks it with Google, saves it only if it works and recreates the office.
set -euo pipefail
cd "$(dirname "$0")/.."
FILE=.env.gemini
if [ -t 0 ]; then printf "Paste your Gemini API key (hidden): "; fi
IFS= read -rs KEY || true
echo
KEY="$(printf %s "$KEY" | tr -d "[:space:]")"
[ -n "$KEY" ] || { echo "Empty key. Nothing changed."; exit 1; }
CODE=$(printf "header = \"x-goog-api-key: %s\"\n" "$KEY" | curl -s -o /dev/null -m 20 -w "%{http_code}" -K - https://generativelanguage.googleapis.com/v1beta/models || true)
if [ "$CODE" != 200 ]; then
  echo "Google rejected the key (HTTP $CODE). Nothing changed."
  exit 1
fi
( umask 077; printf "GEMINI_API_KEY=%s\n" "$KEY" > "$FILE" )
echo "Key works, saved to $PWD/$FILE."
docker compose up -d open-office
