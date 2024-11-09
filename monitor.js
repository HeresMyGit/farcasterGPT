const fs = require('fs');
const { exec, execSync } = require('child_process');

// Path to the log file
const LOG_FILE = 'output.log';
// Command to restart the Node.js script
const COMMAND = 'node index.js > output.log 2>&1';
// Check interval in milliseconds
const CHECK_INTERVAL = 10000;
// Timeout threshold in milliseconds (20 seconds)
const TIMEOUT_THRESHOLD = 20000;

// Function to find the last relevant "MF-GPT APP-IS-UP" timestamp
function getLastRelevantTimestamp() {
  try {
    // Read the log file
    const data = fs.readFileSync(LOG_FILE, 'utf-8');
    // Filter lines containing "MF-GPT APP-IS-UP"
    const lines = data.split('\n').filter((line) => line.includes('MF-GPT APP-IS-UP'));
    if (lines.length === 0) {
      throw new Error('No relevant "MF-GPT APP-IS-UP" logs found.');
    }
    // Get the last relevant line
    const lastLine = lines[lines.length - 1];

    // Extract the timestamp from the start of the line (up to the first colon)
    const timestampString = lastLine.match(/^\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2} (AM|PM)/)?.[0];
    if (!timestampString) {
      throw new Error(`Invalid timestamp format in line: ${lastLine}`);
    }

    // Parse the timestamp
    const timestamp = new Date(timestampString);
    if (isNaN(timestamp)) {
      throw new Error(`Invalid timestamp: ${timestampString}`);
    }

    return timestamp.getTime();
  } catch (err) {
    console.error(`Error parsing log file: ${err.message}`);
    return null;
  }
}

// Function to restart the script
function restartScript() {
  try {
    console.log('Restarting script...');
    // Kill existing script process (assuming no other "node index.js" instances)
    execSync('pkill -f "node index.js"', { stdio: 'ignore' });
  } catch (err) {
    console.log('No existing process to kill or other error.');
  }
  // Start the script
  exec(COMMAND, (err) => {
    if (err) {
      console.error(`Error restarting script: ${err.message}`);
    } else {
      console.log('Script restarted successfully.');
    }
  });
}

// Function to monitor the log file
function monitor() {
  setInterval(() => {
    const now = Date.now();
    const lastTimestamp = getLastRelevantTimestamp();
    if (lastTimestamp) {
      const timeDiff = now - lastTimestamp;
      console.log(`Last relevant update was ${timeDiff / 1000} seconds ago.`);
      if (timeDiff > TIMEOUT_THRESHOLD) {
        console.log('Timestamp stale. Restarting the script...');
        restartScript();
      }
    }
  }, CHECK_INTERVAL);
}

// Start monitoring
monitor();