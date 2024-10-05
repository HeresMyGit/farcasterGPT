// scheduler.js

const { runDailySummary, runTrendingSummary } = require('./dailySummary');
const { castDailySummary, castTrendingSummary, castDailyMeme } = require('./castDailySummary');
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

cron.schedule('0 7 * * *', async () => {
  try {
    console.log('Running daily summary and cast at 7am PT');
    await runTrendingSummary();
    await castTrendingSummary();
  } catch (error) {
    console.error('Error during scheduled tasks:', error);
  }
}, {
  timezone: 'America/Los_Angeles' // Set to Pacific Time
});

// Schedule castDailyMeme to run every 6 hours starting at 6am PT
cron.schedule('0 6,12,18,0 * * *', async () => {
  try {
    console.log('Running castDailyMeme every 6 hours starting at 6am PT');
    await castDailyMeme();
  } catch (error) {
    console.error('Error during castDailyMeme task:', error);
  }
}, {
  timezone: 'America/Los_Angeles' // Set to Pacific Time
});

setInterval(() => {
    const now = new Date();
    console.log(`${now.toLocaleString()}: UP`);
}, 15000);

console.log('Scheduler started: running tasks at 4 PM / 7 AM PT daily.');