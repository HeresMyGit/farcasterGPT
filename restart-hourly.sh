#!/bin/bash
# Restart script for farcasterGPT every hour
# Add to crontab with: 0 * * * * /path/to/restart-hourly.sh

echo "$(date): Restarting farcasterGPT..."

# Kill existing process
pkill -f "node index.js"

# Wait a moment
sleep 5

# Start the application
cd /Users/joshclarke/Documents/Development/AI/farcasterGPT
nohup node index.js > output.log 2>&1 &

echo "$(date): farcasterGPT restarted"
