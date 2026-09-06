#!/bin/sh
set -eu
db="${CCB_DB_PATH:-/data/cc-bridge.db}"
mkdir -p "$(dirname "$db")"
chown -R node:node "$(dirname "$db")" || true
exec su-exec node yarn start
