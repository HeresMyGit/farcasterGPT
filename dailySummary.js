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

const RECENT_THREADS_FILE = path.resolve(__dirname, 'recent_threads.json');

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

async function runDailySummary() {
  const recentFarcasterThreadIds = loadRecentThreads();

  for (const farcasterThreadId of recentFarcasterThreadIds) {
    try {
      // Get messages from Farcaster thread
      const farcasterMessages = await fetchFarcasterThreadMessages(farcasterThreadId);

      // Use mferGPT to write a summary of what happened
      const summary = await generateSummary(farcasterMessages);

      // Push the summary to the summaries array
      summaries.push({
        date: today,
        farcasterThreadId,
        summary,
      });
    } catch (error) {
      console.error(`Error processing Farcaster thread: ${farcasterThreadId}:`, error);
    }
  }

  // Save the summaries to the daily summary file
  fs.writeFileSync('daily_summary.json', JSON.stringify(summaries, null, 2));

  console.log('Daily summary saved to daily_summary.json');
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