#!/bin/bash
# Restart script for XMTP server every hour
# Automatically configured by restart.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$SCRIPT_DIR/restart-hourly.log"

echo "$(date): Restarting XMTP server..." >> "$LOG_FILE"

# Kill existing XMTP process
pkill -f "node xmtpServer.js"

# Wait a moment
sleep 5

# Start the XMTP server
cd "$SCRIPT_DIR"
nohup node xmtpServer.js > outputXmtp.log 2>&1 &

echo "$(date): XMTP server restarted (PID $!)" >> "$LOG_FILE"
