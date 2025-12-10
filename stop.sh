#!/bin/bash

echo "🛑 Stopping all FarcasterGPT processes..."

# Kill all existing processes
pkill -f "node index.js" && echo "✅ Stopped index.js" || echo "⚠️ No index.js process found"
pkill -f "node monitor.js" && echo "✅ Stopped monitor.js" || echo "⚠️ No monitor.js process found"
pkill -f "node tweet.js" && echo "✅ Stopped tweet.js" || echo "⚠️ No tweet.js process found"
pkill -f "node scheduler.js" && echo "✅ Stopped scheduler.js" || echo "⚠️ No scheduler.js process found"
pkill -f "node xmtpServer.js" && echo "✅ Stopped xmtpServer.js" || echo "⚠️ No xmtpServer.js process found"

echo ""
echo "🏁 All FarcasterGPT processes stopped!"
echo ""
echo "🔍 Verify: ps aux | grep node" 