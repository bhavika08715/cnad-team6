#!/usr/bin/env bash
# One-command start for Mac / Linux
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node.js LTS from https://nodejs.org first."; exit 1; }
[ -d node_modules ] || npm install --no-audit --no-fund
echo "Starting FoodBridge at http://localhost:3000"
node server.js
