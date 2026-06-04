#!/bin/sh
# Runs as root at container start.
# Fixes Volume ownership so the node user can write state, then drops privileges.
chown -R node:node /cashclaw-data 2>/dev/null || true
exec runuser -u node -- node /app/server.js
