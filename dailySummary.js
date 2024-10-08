// daily_summary.js

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { NeynarAPIClient, FeedType, FilterType } = require('@neynar/nodejs-sdk');
require('dotenv').config();
const fetch = require('node-fetch');
const { saveTrendingSummaries } = require('./threadUtils');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG,
});

// Initialize Neynar client
const neynarClient = new NeynarAPIClient(process.env.NEYNAR_API_KEY);

const RECENT_THREADS_FILE = path.resolve(__dirname, '../farcasterGPT-Data/recent_threads.json');

// Initialize an array to hold summaries
let summaries = [];

// Get today's date
const today = new Date().toISOString().split('T')[0];

async function runTrendingSummary() {
  // Fetch the latest trending casts
  const feed = await neynarClient.fetchFeed(FeedType.Filter, {
    filterType: FilterType.GlobalTrending,
  });

  const trendingCasts = feed.casts;

  // Initialize an array to hold summaries
  let trendingSummaries = [];

  // Get today's date
  const today = new Date().toISOString().split('T')[0];

  for (const cast of trendingCasts) {
    const castHash = cast.hash;
    try {
      // Get messages from Farcaster thread
      const farcasterMessages = await fetchFarcasterThreadMessages(castHash);

      // Use OpenAI to write a summary of what happened
      const summary = await generateSummary(farcasterMessages);

      // Push the summary to the trendingSummaries array
      trendingSummaries.push({
        date: today,
        farcasterThreadId: castHash,
        summary,
      });
    } catch (error) {
      console.error(`Error processing Farcaster thread: ${castHash}:`, error);
    }
  }

  // Save the summaries using threadUtils function
  saveTrendingSummaries(trendingSummaries);

  console.log('Trending summaries saved to trending_summaries.json');
}

// Load recent Farcaster threads accessed within the last 24 hours
function loadRecentThreads() {
  if (fs.existsSync(RECENT_THREADS_FILE)) {
    const data = fs.readFileSync(RECENT_THREADS_FILE, 'utf-8');
    const recentThreads = JSON.parse(data);
    const now = new Date();

    // Filter threads accessed within the last 24 hours
    return Object.entries(recentThreads)
      .filter(([threadId, details]) => {
        const threadDate = new Date(details.timestamp);
        const hoursDifference = (now - threadDate) / (1000 * 60 * 60);
        return hoursDifference <= 24;
      })
      .map(([threadId]) => threadId);
  }
  return [];
}

// Fetch notifications until they are all 24h old
async function fetchRecentNotifications(cursor = '') {
  const url = 'https://api.neynar.com/v2/farcaster/notifications?fid=853707&type=mentions&priority_mode=false';
  const headers = { accept: 'application/json', api_key: process.env.NEYNAR_API_KEY };

  const requestUrl = cursor ? `${url}&cursor=${cursor}` : url;
  console.log(`Fetching notifications with cursor: ${cursor}`);
  
  try {
    const response = await fetch(requestUrl, { method: 'GET', headers });
    if (!response.ok) {
      console.error(`Error fetching notifications: ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    const notifications = data.notifications;
    const nextCursor = data.next ? data.next.cursor : null;

    // Filter notifications older than 24 hours
    const now = new Date();
    const recentNotifications = notifications.filter(notification => {
      const notificationDate = new Date(notification.most_recent_timestamp);
      return (now - notificationDate) / (1000 * 60 * 60) <= 24; // within 24 hours
    });

    // Log a brief summary of each notification
    recentNotifications.forEach((notification, index) => {
      const author = notification.cast.author.username || 'unknown';
      const snippet = notification.cast.text.slice(0, 30); // Log the first 30 characters of the text
      console.log(`Notification ${index + 1}: ${author} - "${snippet}"`);
    });

    // Recursively fetch more notifications if needed
    if (nextCursor && recentNotifications.length === notifications.length) {
      const olderNotifications = await fetchRecentNotifications(nextCursor);
      return recentNotifications.concat(olderNotifications);
    }

    return recentNotifications;

  } catch (error) {
    console.error('Error fetching notifications:', error.message);
    return [];
  }
}


// Fetch and summarize threads
async function runDailySummary() {
  try {
    const notifications = await fetchRecentNotifications();
    const uniqueThreadHashes = new Set();
    const summaries = [];

    for (const notification of notifications) {
      const threadHash = notification.cast.thread_hash;
      if (uniqueThreadHashes.has(threadHash)) continue;
      uniqueThreadHashes.add(threadHash);

      const threadMessages = await fetchFarcasterThreadMessages(threadHash);
      const summary = await generateSummary(threadMessages);

      summaries.push({ threadHash, summary });
    }

    // Here, you would write the summarized posts using your preferred method
    console.log('Summaries:', summaries);

      // Save the summaries to the daily summary file
    fs.writeFileSync('daily_summary.json', JSON.stringify(summaries, null, 2));

    console.log('Daily summary saved to daily_summary.json');
  } catch (error) {
    console.error('Error summarizing threads:', error);
  }
}

// Functions

async function fetchFarcasterThreadMessages(castHash) {
  const url = `https://api.neynar.com/v2/farcaster/cast/conversation?identifier=${castHash}&type=hash&reply_depth=5&include_chronological_parent_casts=false&limit=40`;
  const options = {
    method: 'GET',
    headers: {
      accept: 'application/json',
      api_key: process.env.NEYNAR_API_KEY, // Use the API key from environment variables
    },
  };

  try {
    console.warn(`Fetching Farcaster thread: ${castHash}`);
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`Failed to fetch thread messages: ${response.statusText}`);
    }

    const data = await response.json();

    // Extract the main cast and direct replies
    const mainCast = data.conversation.cast;
    const directReplies = mainCast.direct_replies || [];

    // Combine the main cast and all direct replies into a single array
    const allMessages = [mainCast, ...directReplies];

    // Recursively gather messages from nested direct replies
    const gatherMessages = (replies) => {
      return replies.flatMap((reply) => {
        const nestedReplies = reply.direct_replies || [];
        return [reply, ...gatherMessages(nestedReplies)];
      });
    };

    // Get all nested messages
    const nestedMessages = gatherMessages(directReplies);

    // Combine main cast messages and nested messages
    const combinedMessages = [mainCast, ...nestedMessages];

    return combinedMessages;
  } catch (error) {
    console.error('Error fetching thread messages:', error.message);
    return [];
  }
}

async function generateSummary(farcasterMessages) {
  // Prepare the messages for summarization
  const farcasterText = farcasterMessages
    .map((msg) => `${msg.author.display_name}: ${msg.text}`)
    .join('\n');

  // Prepare the prompt
  const prompt = `Summarize the following conversation between users on Farcaster:

Farcaster Messages:
${farcasterText}

Summary:
`;

  // Use OpenAI's API to generate the summary
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }]
    });

    const summary = completion.choices[0].message.content;
    return summary;
  } catch (error) {
    console.error('Error generating summary:', error);
    return 'Summary could not be generated.';
  }
}

module.exports = { runDailySummary, runTrendingSummary };