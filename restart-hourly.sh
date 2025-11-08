#!/bin/bash

set -euo pipefail

# Restart script for farcasterGPT every hour
# Add to crontab with: 0 * * * * /path/to/restart-hourly.sh

echo "$(date): Restarting farcasterGPT..."

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Kill existing processes if they are running
pkill -f "node index.js" 2>/dev/null || true
pkill -f "node xmtp.js" 2>/dev/null || true

# Wait a moment
sleep 5

# Start the applications
nohup node index.js > output.log 2>&1 &
nohup node xmtp.js > outputXmtp.log 2>&1 &

echo "$(date): farcasterGPT restarted"
