// scheduler.js

const { runDailySummary, runTrendingSummary } = require('./dailySummary');
const { castDailySummary, castTrendingSummary, castDailyMeme } = require('./castDailySummary');
const cron = require('node-cron');
const { sendTweet } = require('./twitter');

// Sending a tweet with text only
// sendTweet('This is a tweet without an image.');

// Sending a tweet with text and an image
// sendTweet('This is a tweet with an image.', './path-to-your-image.jpg');

(async () => {
  try {
    console.log('Running daily summary and cast at 4 PM PT');
    // await runDailySummary();
    // await castDailySummary();
    // await runTrendingSummary();
  // await castTrendingSummary();
    // await castDailyMeme();
    await sendTweet('This is a tweet without an image.');
  } catch (error) {
    console.error('Error during scheduled tasks:', error);
  }

})();

