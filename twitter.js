require('dotenv').config(); // Load environment variables
const axios = require('axios');
const OAuth = require('oauth-1.0a');
const crypto = require('crypto');
const fs = require('fs'); // For reading image files
const path = require('path');
const FormData = require('form-data');
const { loadMemedTweets, hasMemedToTweet, saveMemedTweet, saveRepliedTweet } = require('./threadUtils');
const { openai } = require('./client');


// Get your OAuth credentials from environment variables
const {
  CONSUMER_KEY,
  CONSUMER_SECRET,
  ACCESS_TOKEN,
  ACCESS_TOKEN_SECRET,
  BEARER_TOKEN,
  BEARER_TOKEN_2,
  BEARER_TOKEN_3
} = process.env;

// Order of bearer tokens to try for search API calls.
const bearerTokens = [
  BEARER_TOKEN,   // primary bearer token
  BEARER_TOKEN_2, // secondary token
  BEARER_TOKEN_3  // tertiary token
].filter(Boolean);

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

// Wrapper to fetch with bearer token fallback for Twitter search endpoints.
async function fetchWithBearerFallback(url, extraHeaders = {}) {
  if (!bearerTokens.length) {
    throw new Error('No bearer tokens configured for search requests.');
  }

  let lastError;

  for (const token of bearerTokens) {
    try {
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'PostmanRuntime/7.42.0',
          Accept: '*/*',
          ...extraHeaders,
        }
      });

      // Check for usage cap errors in successful responses
      const responseData = response.data;
      if (responseData?.title === 'UsageCapExceeded' || 
          responseData?.type === 'https://api.twitter.com/2/problems/usage-capped') {
        console.warn(`Bearer token usage cap exceeded. Trying next token if available.`);
        lastError = new Error('UsageCapExceeded: ' + (responseData?.detail || 'Monthly product cap'));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      const errorData = error?.response?.data;
      
      // Check for usage cap in error response
      if (errorData?.title === 'UsageCapExceeded' || 
          errorData?.type === 'https://api.twitter.com/2/problems/usage-capped') {
        console.warn(`Bearer token usage cap exceeded. Trying next token if available.`);
        continue;
      }

      console.warn(`Bearer token attempt failed (${status || error.message}). Trying next token if available.`);

      // For non-transient errors, stop early to avoid masking real issues.
      if (![401, 403, 429, 500, 503].includes(status)) {
        break;
      }
    }
  }

  throw lastError || new Error('All bearer token attempts failed.');
}

async function selectTweetWithMferGPT(tweets, users, searchTerm) {
  try {
    const model = process.env.MFERGPT_MODEL || 'gpt-4o-mini';

    const tweetSummaries = tweets.map(tweet => {
      const user = users?.find(u => u.id === tweet.author_id);
      return [
        `ID: ${tweet.id}`,
        `Author: ${user?.username || tweet.author_id}`,
        `Likes: ${tweet.public_metrics?.like_count ?? 0}`,
        `Text: ${tweet.text}`
      ].join('\n');
    }).join('\n\n');

    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are MFERGPT, an LLM that selects the best tweet to meme. Choose the tweet that is most aligned with mfers culture, crypto, or AI vibes. Prefer tweets that explicitly mention these themes or strongly imply them.'
        },
        {
          role: 'user',
          content: `Search term: ${searchTerm}\n\nHere are the candidate tweets:\n${tweetSummaries}\n\nRespond with only the ID of the single best tweet. If none fit, reply NONE.`
        }
      ],
      temperature: 0.2,
    });

    const choice = response.choices?.[0]?.message?.content?.trim();

    if (!choice || choice.toLowerCase() === 'none') {
      console.warn('MFERGPT did not select a tweet.');
      return null;
    }

    const idMatch = choice.match(/\d+/);
    if (!idMatch) {
      console.warn('MFERGPT response did not include a tweet ID:', choice);
      return null;
    }

    const selectedTweet = tweets.find(tweet => tweet.id === idMatch[0]);

    if (!selectedTweet) {
      console.warn('MFERGPT selected an ID that was not in the candidate list:', idMatch[0]);
    }

    return selectedTweet || null;
  } catch (error) {
    console.error('Error selecting tweet with MFERGPT:', error.response ? error.response.data : error.message);
    return null;
  }
}

async function fetchMostPopularMferTweet(searchTerm = 'mfercoin') {
  console.log(`Fetching the most popular tweet for "${searchTerm}" from the last 24 hours...`);

  // Hard-coded list of author IDs to ignore
  const ignoredAuthorIds = [
    '1522162732451377153', 
  ];

  try {
    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(); // 24 hours
    const baseURL = 'https://api.twitter.com/2/tweets/search/recent';
    const queryParams = `query=${encodeURIComponent(searchTerm)}&tweet.fields=public_metrics,referenced_tweets,attachments,author_id&user.fields=username,profile_image_url,name&media.fields=url&expansions=attachments.media_keys,author_id&start_time=${sixHoursAgo}&max_results=10`;
    const searchURL = `${baseURL}?${queryParams}`;

    // Use Bearer Token for authorization with fallback
    const response = await fetchWithBearerFallback(searchURL);

    const tweets = response.data?.data;
    const users = response.data?.includes?.users;

    if (!tweets || tweets.length === 0) {
      console.log(`No tweets found for "${searchTerm}" in the last 24 hours.`);
      return null;
    }

    // Log all tweets and user data for debugging
    console.log('Fetched tweets:', JSON.stringify(tweets, null, 2));
    console.log('Fetched users:', JSON.stringify(users, null, 2));

    // Load the list of already memed tweet IDs
    const memedTweets = await loadMemedTweets();

    // Filter out tweets that have already been memed and those from ignored authors
    const unmemedTweets = tweets.filter(tweet => 
      !memedTweets.includes(tweet.id) &&
      !ignoredAuthorIds.includes(tweet.author_id)
    );

    if (!unmemedTweets || unmemedTweets.length === 0) {
      console.log('All fetched tweets are either already memed or authored by ignored accounts.');
      return null;
    }

    // Log filtered tweets for debugging
    console.log('Unmemed tweets:', JSON.stringify(unmemedTweets, null, 2));

    // Ask MFERGPT to pick the best tweet with mfer/crypto/AI vibes
    let selectedTweet = await selectTweetWithMferGPT(unmemedTweets, users, searchTerm);

    // Fallback to most liked tweet if the LLM cannot pick one
    if (!selectedTweet) {
      console.warn('Falling back to most liked tweet because MFERGPT did not select one.');
      selectedTweet = unmemedTweets.reduce((prev, current) =>
        (current.public_metrics.like_count > prev.public_metrics.like_count ? current : prev)
      );
    }

    if (!selectedTweet || !selectedTweet.id) {
      console.error('No valid tweet to save to memed list.');
      return null;
    }

    // Get the user information for the selected tweet
    const authorId = selectedTweet.author_id;
    const userInfo = users?.find(user => user.id === authorId);

    console.log('Selected tweet:', JSON.stringify(selectedTweet, null, 2));
    console.log('User info for the tweet:', JSON.stringify(userInfo, null, 2));

    // Save the selected tweet's ID to the memed list
    try {
      await saveMemedTweet(selectedTweet.id);
      console.log(`Saved tweet ID: ${selectedTweet.id} to memed list.`);
    } catch (error) {
      console.error(`Failed to save tweet ID: ${selectedTweet.id} to memed list.`, error);
    }

    return selectedTweet;
  } catch (error) {
    console.error(`Error fetching tweets for "${searchTerm}":`, error.response ? error.response.data : error.message);
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

    // Use Bearer Token for authorization with fallback
    const response = await fetchWithBearerFallback(url);

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

async function sendTweet(text, imagePaths = [], quoteTweetId = null, replyTweetId = null, openAIThreadId = null) {
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
      await saveRepliedTweet(tweetId, openAIThreadId);
      console.log(`Saved replied tweet with ID: ${tweetId}`);
    } else {
      console.error('Failed to extract tweet ID from the response.');
    }

    console.log('Tweet posted successfully:', response.data);
  } catch (error) {
    console.error('Error posting tweet:', error.response ? error.response.data : error.message);
  }
}

module.exports = {
  sendTweet,
  fetchMostPopularMferTweet,
  fetchMostLikedMentions,
};