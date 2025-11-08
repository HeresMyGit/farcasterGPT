#!/bin/bash

set -euo pipefail

echo "🛑 Stopping all FarcasterGPT processes..."

# Kill all existing processes
pkill -f "node index.js" 2>/dev/null && echo "✅ Stopped index.js" || echo "⚠️ No index.js process found"
pkill -f "node xmtp.js" 2>/dev/null && echo "✅ Stopped xmtp.js" || echo "⚠️ No xmtp.js process found"
pkill -f "node monitor.js" 2>/dev/null && echo "✅ Stopped monitor.js" || echo "⚠️ No monitor.js process found"
pkill -f "node tweet.js" 2>/dev/null && echo "✅ Stopped tweet.js" || echo "⚠️ No tweet.js process found"
pkill -f "node scheduler.js" 2>/dev/null && echo "✅ Stopped scheduler.js" || echo "⚠️ No scheduler.js process found"

echo ""
echo "🏁 All FarcasterGPT processes stopped!"
echo ""
echo "🔍 Verify: ps aux | grep node"
