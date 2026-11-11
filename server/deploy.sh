#!/usr/bin/env bash
# Creates (or updates) the Fly app "kiloton-server" from server.ts using the Machines API.
set -euo pipefail
APP="${APP:-kiloton-server}"; ORG="${ORG:-personal}"; REGION="${REGION:-syd}"
H=(-H "Authorization: Bearer ${FLY_API_TOKEN:-proxy-injected}" -H "Content-Type: application/json")
API=https://api.machines.dev/v1
B64=$(base64 -w0 "$(dirname "$0")/server.ts")
CFG=$(cat <<JSON
{"region":"$REGION","config":{"image":"oven/bun:1-alpine","init":{"cmd":["bun","run","/app/server.ts"]},
"files":[{"guest_path":"/app/server.ts","raw_value":"$B64"}],
"guest":{"cpu_kind":"shared","cpus":1,"memory_mb":256},
"services":[{"protocol":"tcp","internal_port":8080,"autostop":"stop","autostart":true,"min_machines_running":0,
"ports":[{"port":443,"handlers":["tls","http"]},{"port":80,"handlers":["http"],"force_https":true}],
"checks":[{"type":"http","path":"/health","interval":"15s","timeout":"3s","method":"GET"}]}],
"restart":{"policy":"on-failure"}}}
JSON
)
code=$(curl -sS -o /dev/null -w '%{http_code}' "${H[@]}" "$API/apps/$APP")
if [ "$code" != 200 ]; then echo "creating app $APP"; curl -sS "${H[@]}" -X POST "$API/apps" -d "{\"app_name\":\"$APP\",\"org_slug\":\"$ORG\"}"; echo; fi
MID=$(curl -sS "${H[@]}" "$API/apps/$APP/machines" | python3 -c "import sys,json;m=json.load(sys.stdin);print(m[0]['id'] if m else '')")
if [ -z "$MID" ]; then echo "creating machine"; curl -sS "${H[@]}" -X POST "$API/apps/$APP/machines" -d "$CFG" | head -c 300; echo
else echo "updating machine $MID"; curl -sS "${H[@]}" -X POST "$API/apps/$APP/machines/$MID" -d "$CFG" | head -c 300; echo; fi
