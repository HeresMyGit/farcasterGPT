// scheduler.js

const { runDailySummary } = require('./dailySummary');
const { castDailySummary } = require('./castDailySummary');
const cron = require('node-cron');

// Schedule the tasks to run every day at 4 PM PT (Pacific Time)
cron.schedule('0 16 * * *', async () => {
  try {
    console.log('Running daily summary and cast at 4 PM PT');
    await runDailySummary();
    await castDailySummary();
  } catch (error) {
    console.error('Error during scheduled tasks:', error);
  }
}, {
  timezone: 'America/Los_Angeles' // Set to Pacific Time
});

console.log('Scheduler started: running tasks at 4 PM PT daily.');