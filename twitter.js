require('dotenv').config(); // Load environment variables
const axios = require('axios');
const OAuth = require('oauth-1.0a');
const crypto = require('crypto');
const fs = require('fs'); // For reading image files
const path = require('path');
const FormData = require('form-data');
const { loadMemedTweets, hasMemedToTweet, saveMemedTweet } = require('./threadUtils');

// Get your OAuth credentials from environment variables
const {
  CONSUMER_KEY,
  CONSUMER_SECRET,
  ACCESS_TOKEN,
  ACCESS_TOKEN_SECRET,
  BEARER_TOKEN
} = process.env;

// Initialize OAuth 1.0a with HMAC-SHA1 signature method
const oauth = OAuth({
  consumer: {
    key: CONSUMER_KEY,
    secret: CONSUMER_SECRET,
  },
  signature_method: 'HMAC-SHA1',
  hash_function(base_string, key) {
    return crypto.createHmac('sha1', key).update(base_string).digest('base64');
  },
});

// Set the access token (user context)
const token = {
  key: ACCESS_TOKEN,
  secret: ACCESS_TOKEN_SECRET,
};

// Helper function to generate the OAuth headers
function generateAuthHeader(url, method) {
  const oauth_timestamp = Math.floor(Date.now() / 1000);
  const oauth_nonce = crypto.randomBytes(16).toString('hex');

  return oauth.toHeader(oauth.authorize({
    url: url,
    method: method,
  }, token));
}

async function fetchMostPopularMferTweet() {
  console.log('Fetching the most popular $mfer tweet from the last 6 hours...');
  try {
    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(); // 24 hours
    const baseURL = 'https://api.twitter.com/2/tweets/search/recent';
    const queryParams = `query=mfercoin&tweet.fields=public_metrics,referenced_tweets,attachments&media.fields=url&expansions=attachments.media_keys&start_time=${sixHoursAgo}&max_results=10`;
    const searchURL = `${baseURL}?${queryParams}`;

    // Use Bearer Token for authorization
    const response = await axios.get(searchURL, {
      headers: {
        Authorization: `Bearer ${BEARER_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'PostmanRuntime/7.42.0',
        'Accept': '*/*',
      }
    });

    // Parse the response
    const tweets = response.data?.data;

    if (!tweets || tweets.length === 0) {
      console.log('No tweets found for $mfer in the last 6 hours.');
      return null;
    }

    // Log all tweets for debugging
    console.log('Fetched tweets:', JSON.stringify(tweets, null, 2));

    // Load the list of already memed tweet IDs
    const memedTweets = await loadMemedTweets();

    // Filter out tweets that have already been memed
    const unmemedTweets = tweets.filter(tweet => !memedTweets.includes(tweet.id));

    if (!unmemedTweets || unmemedTweets.length === 0) {
      console.log('All fetched tweets have already been memed.');
      return null;
    }

    // Log filtered tweets for debugging
    console.log('Unmemed tweets:', JSON.stringify(unmemedTweets, null, 2));

    // Find the most popular tweet based on likes
    const mostPopularTweet = unmemedTweets.reduce((prev, current) =>
      (current.public_metrics.like_count > prev.public_metrics.like_count ? current : prev)
    );

    if (!mostPopularTweet || !mostPopularTweet.id) {
      console.error('No valid tweet to save to memed list.');
      return null;
    }

    console.log('Most popular unmemed tweet:', JSON.stringify(mostPopularTweet, null, 2));

    // Save the most popular tweet's ID to the memed list
    try {
      await saveMemedTweet(mostPopularTweet.id);
      console.log(`Saved tweet ID: ${mostPopularTweet.id} to memed list.`);
    } catch (error) {
      console.error(`Failed to save tweet ID: ${mostPopularTweet.id} to memed list.`, error);
    }

    return mostPopularTweet;
  } catch (error) {
    console.error('Error fetching $mfer tweets:', error.response ? error.response.data : error.message);
    return null;
  }
}

async function fetchMostLikedMentions(userId, count = 10) {
  console.log(`Fetching the last ${count} tweets mentioning user ID: ${userId}...`);
  try {
    const now = new Date();
    const baseURL = `https://api.twitter.com/2/users/${userId}/mentions`;
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(); 
    const queryParams = `max_results=${count}&tweet.fields=public_metrics,referenced_tweets,attachments&media.fields=url&expansions=attachments.media_keys&start_time=${sixHoursAgo}`;
    const url = `${baseURL}?${queryParams}`;

    // Use Bearer Token for authorization
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${BEARER_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'PostmanRuntime/7.42.0',
        'Accept': '*/*',
      }
    });

    const mentions = response.data.data;

    if (!mentions || mentions.length === 0) {
      console.log('No mentions found.');
      return null;
    }

    // console.log('Fetched mentions:', JSON.stringify(mentions, null, 2));

    return mentions;
  } catch (error) {
    console.error('Error fetching mentions:', error.response ? error.response.data : error.message);
    return null;
  }
}

// Function to upload media to Twitter
async function uploadMedia(imagePath) {
  const url = 'https://upload.twitter.com/1.1/media/upload.json';
  const mediaData = fs.readFileSync(imagePath); // read as binary for FormData

  const form = new FormData();
  form.append('media', mediaData);

  const authHeader = generateAuthHeader(url, 'POST');

  const response = await axios.post(url, form, {
    headers: {
      ...authHeader,
      ...form.getHeaders() // include form-data headers
    }
  });

  return response.data.media_id_string;
}

async function sendTweet(text, imagePaths = [], quoteTweetId = null, replyTweetId = null) {
  try {
    let media_ids = [];
    console.log("images: ", imagePaths);

    // Upload each image and collect the media IDs
    for (const imagePath of imagePaths) {
      const resolvedPath = path.resolve(imagePath);
      console.log(`Uploading image from: ${resolvedPath}`);
      const media_id = await uploadMedia(resolvedPath);
      media_ids.push(media_id);
      console.log(`Media uploaded with ID: ${media_id}`);
    }

    // Create tweet content
    const tweetData = {
      text: text,
    };

    // Include media if available
    if (media_ids.length > 0) {
      tweetData.media = { media_ids: media_ids };
    }

    // Add quote-tweet functionality
    if (quoteTweetId) {
      tweetData.quote_tweet_id = quoteTweetId;
    }

    // Add reply functionality
    if (replyTweetId) {
      tweetData.reply = { in_reply_to_tweet_id: replyTweetId };
    }

    const tweetURL = 'https://api.twitter.com/2/tweets';
    const authHeader = generateAuthHeader(tweetURL, 'POST');

    // Send the tweet
    const response = await axios.post(tweetURL, tweetData, {
      headers: {
        Authorization: authHeader['Authorization'],
        'Content-Type': 'application/json',
        'User-Agent': 'PostmanRuntime/7.42.0',
        'Accept': '*/*',
      },
    });

    // Correctly access the tweet ID from the response and save it
    const tweetId = response.data?.data?.id;
    if (tweetId) {
      await saveRepliedTweet(tweetId, replyTweetId || quoteTweetId);
      console.log(`Saved replied tweet with ID: ${tweetId}`);
    } else {
      console.error('Failed to extract tweet ID from the response.');
    }

    console.log('Tweet posted successfully:', response.data);
  } catch (error) {
    console.error('Error posting tweet:', error.response ? error.response.data : error.message);
  }
}

(async () => {
  // const USER_ID = '1724482668195110912'; // Replace with your actual user ID
  // await fetchAndReplyToMostLikedMention(USER_ID);
  await fetchMostPopularMferTweet()
})();

module.exports = {
  sendTweet,
  fetchMostPopularMferTweet,
  fetchMostLikedMentions,
};