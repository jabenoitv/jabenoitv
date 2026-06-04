#!/bin/sh
# Runs as root at container start.
# Fixes Volume ownership so the node user can write state, then drops privileges.
chown node:node /cashclaw-data 2>/dev/null || true
exec su -s /bin/sh node -c 'exec node /app/server.js'
