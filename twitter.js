require('dotenv').config(); // Load environment variables
const axios = require('axios');
const OAuth = require('oauth-1.0a');
const crypto = require('crypto');
const fs = require('fs'); // For reading image files
const path = require('path');
const FormData = require('form-data');

// Get your OAuth credentials from environment variables
const {
  CONSUMER_KEY,
  CONSUMER_SECRET,
  ACCESS_TOKEN,
  ACCESS_TOKEN_SECRET
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

// Main function to send a tweet
async function sendTweet(text, imageURL = null) {
  try {
    let media_id = null;

    // Upload the image if an imageURL is provided
    if (imageURL) {
      const imagePath = path.resolve(imageURL);
      console.log(`Uploading image from: ${imagePath}`);
      media_id = await uploadMedia(imagePath);
      console.log(`Media uploaded with ID: ${media_id}`);
    }

    // Create tweet content
    const tweetData = {
      text: text,
    };

    if (media_id) {
      tweetData.media = { media_ids: [media_id] };
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
      }
    });

    console.log('Tweet posted successfully:', response.data);
  } catch (error) {
    console.error('Error posting tweet:', error.response ? error.response.data : error.message);
  }
}

module.exports = {
  sendTweet,
};