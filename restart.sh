#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🛑 Stopping all FarcasterGPT processes..."

# Kill all existing processes
echo "Killing existing processes..."
pkill -f "node index.js" && echo "✅ Stopped index.js" || echo "⚠️ No index.js process found"
pkill -f "node monitor.js" && echo "✅ Stopped monitor.js" || echo "⚠️ No monitor.js process found"
pkill -f "node tweet.js" && echo "✅ Stopped tweet.js" || echo "⚠️ No tweet.js process found"
pkill -f "node scheduler.js" && echo "✅ Stopped scheduler.js" || echo "⚠️ No scheduler.js process found"
pkill -f "node xmtpServer.js" && echo "✅ Stopped xmtpServer.js" || echo "⚠️ No xmtpServer.js process found"
# niftyServer.js was removed - this kills any zombie processes from old deployments
pkill -f "node niftyServer.js" && echo "✅ Stopped niftyServer.js (zombie cleanup)" || true

# Wait a moment for processes to fully terminate
echo "Waiting 3 seconds for processes to terminate..."
sleep 3

echo ""
echo "🚀 Starting all FarcasterGPT services..."

# Start all services with nohup
nohup node index.js > output.log 2>&1 &
INDEX_PID=$!
echo "✅ Main app (index.js): PID $INDEX_PID"

nohup node monitor.js > outputMonitor.log 2>&1 &
MONITOR_PID=$!
echo "✅ Monitor (monitor.js): PID $MONITOR_PID"

nohup node tweet.js > outputTweet.log 2>&1 &
TWEET_PID=$!
echo "✅ Twitter bot (tweet.js): PID $TWEET_PID"

nohup node scheduler.js > outputScheduler.log 2>&1 &
SCHEDULER_PID=$!
echo "✅ Scheduler (scheduler.js): PID $SCHEDULER_PID"

nohup node xmtpServer.js > outputXmtp.log 2>&1 &
XMTP_PID=$!
echo "✅ XMTP Server (xmtpServer.js): PID $XMTP_PID"

echo ""
echo "🎉 All services started successfully!"
echo ""
echo "📊 Process Status:"
echo "  Main App:   PID $INDEX_PID"
echo "  Monitor:    PID $MONITOR_PID" 
echo "  Twitter:    PID $TWEET_PID"
echo "  Scheduler:  PID $SCHEDULER_PID"
echo "  XMTP:       PID $XMTP_PID"
echo ""
echo "📝 Log files:"
echo "  Main:       tail -f output.log"
echo "  Monitor:    tail -f outputMonitor.log"
echo "  Twitter:    tail -f outputTweet.log"
echo "  Scheduler:  tail -f outputScheduler.log"
echo "  XMTP:       tail -f outputXmtp.log"
echo ""
echo "🔍 Check status: ps aux | grep node"

# Set up hourly XMTP restart cron job
echo ""
echo "⏰ Setting up hourly XMTP restart cron job..."
CRON_CMD="0 * * * * $SCRIPT_DIR/restart-hourly.sh"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "restart-hourly.sh"; then
    echo "✅ Hourly XMTP restart cron job already configured"
else
    # Add the cron job
    (crontab -l 2>/dev/null; echo "$CRON_CMD") | crontab -
    echo "✅ Hourly XMTP restart cron job added"
fi
echo "   XMTP will restart automatically at the top of every hour" 