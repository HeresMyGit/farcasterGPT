// scheduler.js

const { runDailySummary, runTrendingSummary } = require('./dailySummary');
const { castDailySummary, castTrendingSummary } = require('./castDailySummary');
const cron = require('node-cron');

(async () => {
  try {
    console.log('Running daily summary and cast at 4 PM PT');
    await runDailySummary();
    await castDailySummary();
    await runTrendingSummary();
  await castTrendingSummary();
  } catch (error) {
    console.error('Error during scheduled tasks:', error);
  }

})();

