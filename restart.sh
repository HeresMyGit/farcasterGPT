#!/bin/bash

echo "🛑 Stopping all FarcasterGPT processes..."

# Kill all existing processes
echo "Killing existing processes..."
pkill -f "node index.js" && echo "✅ Stopped index.js" || echo "⚠️ No index.js process found"
pkill -f "node monitor.js" && echo "✅ Stopped monitor.js" || echo "⚠️ No monitor.js process found"
pkill -f "node tweet.js" && echo "✅ Stopped tweet.js" || echo "⚠️ No tweet.js process found"
pkill -f "node scheduler.js" && echo "✅ Stopped scheduler.js" || echo "⚠️ No scheduler.js process found"

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

echo ""
echo "🎉 All services started successfully!"
echo ""
echo "📊 Process Status:"
echo "  Main App:   PID $INDEX_PID"
echo "  Monitor:    PID $MONITOR_PID" 
echo "  Twitter:    PID $TWEET_PID"
echo "  Scheduler:  PID $SCHEDULER_PID"
echo ""
echo "📝 Log files:"
echo "  Main:       tail -f output.log"
echo "  Monitor:    tail -f outputMonitor.log"
echo "  Twitter:    tail -f outputTweet.log"
echo "  Scheduler:  tail -f outputScheduler.log"
echo ""
echo "🔍 Check status: ps aux | grep node" 