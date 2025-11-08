#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🛑 Stopping all FarcasterGPT processes..."

echo "Killing existing processes..."

stop_process() {
  local pattern="$1"
  local label="$2"

  if pkill -f "$pattern" 2>/dev/null; then
    echo "✅ Stopped $label"
  else
    echo "⚠️ No $label process found"
  fi
}

stop_process "node index.js" "index.js"
stop_process "node xmtp.js" "xmtp.js"
stop_process "node monitor.js" "monitor.js"
stop_process "node tweet.js" "tweet.js"
stop_process "node scheduler.js" "scheduler.js"

# Wait a moment for processes to fully terminate
echo "Waiting 3 seconds for processes to terminate..."
sleep 3

echo ""
echo "🚀 Starting all FarcasterGPT services..."

start_service() {
  local script="$1"
  local log_file="$2"
  nohup node "$script" > "$log_file" 2>&1 &
  echo $!
}

INDEX_PID=$(start_service "index.js" "output.log")
echo "✅ Main app (index.js): PID $INDEX_PID"
XMTP_PID=$(start_service "xmtp.js" "outputXmtp.log")
echo "✅ XMTP service (xmtp.js): PID $XMTP_PID"
MONITOR_PID=$(start_service "monitor.js" "outputMonitor.log")
echo "✅ Monitor (monitor.js): PID $MONITOR_PID"
TWEET_PID=$(start_service "tweet.js" "outputTweet.log")
echo "✅ Twitter bot (tweet.js): PID $TWEET_PID"
SCHEDULER_PID=$(start_service "scheduler.js" "outputScheduler.log")
echo "✅ Scheduler (scheduler.js): PID $SCHEDULER_PID"

echo ""
echo "🎉 All services started successfully!"
echo ""
echo "📊 Process Status:"
echo "  Main App:   PID $INDEX_PID"
echo "  XMTP:       PID $XMTP_PID"
echo "  Monitor:    PID $MONITOR_PID"
echo "  Twitter:    PID $TWEET_PID"
echo "  Scheduler:  PID $SCHEDULER_PID"

echo ""
echo "📝 Log files:"
echo "  Main:       tail -f output.log"
echo "  XMTP:       tail -f outputXmtp.log"
echo "  Monitor:    tail -f outputMonitor.log"
echo "  Twitter:    tail -f outputTweet.log"
echo "  Scheduler:  tail -f outputScheduler.log"

echo ""
echo "🔍 Check status: ps aux | grep node"
