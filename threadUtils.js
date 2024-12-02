const fs = require('fs');
const path = require('path');

const THREADS_FILE = path.resolve(__dirname, '../farcasterGPT-Data/threadMappings.json');
const RECENT_THREADS_FILE = path.resolve(__dirname, '../farcasterGPT-Data/recent_threads.json');
const TRENDING_SUMMARIES_FILE = path.resolve(__dirname, '../farcasterGPT-Data/trending_summaries.json');
const USER_PROFILES_FILE = path.resolve(__dirname, '../farcasterGPT-Data/userProfiles.json');
const PERSONAL_PROMPTS_FILE = path.resolve(__dirname, '../farcasterGPT-Data/personalPrompts.json');
const IMAGE_LOG_FILE = path.resolve(__dirname, '../farcasterGPT-Data/imageLog.json');
const MINT_LOG_FILE = path.resolve(__dirname, '../farcasterGPT-Data/mintLog.json');
const USER_MINT_FILE = path.resolve(__dirname, '../farcasterGPT-Data/userMint.json');
const REPLIED_TWEETS_FILE = path.resolve(__dirname, '../farcasterGPT-Data/repliedTweets.json');



// Load existing thread mappings from file
function loadThreadMappings() {
  if (fs.existsSync(THREADS_FILE)) {
    const data = fs.readFileSync(THREADS_FILE, 'utf-8');
    return JSON.parse(data);
  }
  return {};
}

// Save updated thread mappings to file
function saveThreadMappings(mappings) {
  fs.writeFileSync(THREADS_FILE, JSON.stringify(mappings, null, 2));
}

// Load existing recent threads from file
function loadRecentThreads() {
  if (fs.existsSync(RECENT_THREADS_FILE)) {
    const data = fs.readFileSync(RECENT_THREADS_FILE, 'utf-8');
    return JSON.parse(data);
  }
  return {};
}

// Save updated recent threads to file
function saveRecentThreads(recentThreads) {
  fs.writeFileSync(RECENT_THREADS_FILE, JSON.stringify(recentThreads, null, 2));
}

// Update recent threads with the current access or save action
function updateRecentThreads(threadId) {
  const recentThreads = loadRecentThreads();
  recentThreads[threadId] = {
    timestamp: new Date().toISOString(),
  };
  saveRecentThreads(recentThreads);
}

// Retrieve OpenAI thread ID by Farcaster thread ID
function getOpenAIThreadId(farcasterThreadId) {
  const mappings = loadThreadMappings();
  const openAIThreadId = mappings[farcasterThreadId];
  if (openAIThreadId) {
    updateRecentThreads(farcasterThreadId);
  }
  return openAIThreadId;
}

// Save the mapping of Farcaster thread to OpenAI thread
function saveOpenAIThreadId(farcasterThreadId, openAIThreadId) {
  const mappings = loadThreadMappings();
  mappings[farcasterThreadId] = openAIThreadId;
  saveThreadMappings(mappings);
  updateRecentThreads(farcasterThreadId);
}

// Load trending summaries from file
function loadTrendingSummaries() {
  if (fs.existsSync(TRENDING_SUMMARIES_FILE)) {
    const data = fs.readFileSync(TRENDING_SUMMARIES_FILE, 'utf-8');
    return JSON.parse(data);
  }
  return [];
}

// Save trending summaries to file
function saveTrendingSummaries(summaries) {
  fs.writeFileSync(TRENDING_SUMMARIES_FILE, JSON.stringify(summaries, null, 2));
}

// Load user profiles from file
function loadUserProfiles() {
  if (fs.existsSync(USER_PROFILES_FILE)) {
    const data = fs.readFileSync(USER_PROFILES_FILE, 'utf-8');
    return JSON.parse(data);
  }
  return {};
}

// Save user profiles to file
function saveUserProfiles(profiles) {
  fs.writeFileSync(USER_PROFILES_FILE, JSON.stringify(profiles, null, 2));
}

// Load personal prompts from file
function loadPersonalPrompts() {
  if (fs.existsSync(PERSONAL_PROMPTS_FILE)) {
    const data = fs.readFileSync(PERSONAL_PROMPTS_FILE, 'utf-8');
    return JSON.parse(data);
  }
  return {};
}

// Save personal prompts to file
function savePersonalPrompts(prompts) {
  fs.writeFileSync(PERSONAL_PROMPTS_FILE, JSON.stringify(prompts, null, 2));
}

// Load image log from file
function loadImageLog() {
  if (fs.existsSync(IMAGE_LOG_FILE)) {
    const data = fs.readFileSync(IMAGE_LOG_FILE, 'utf-8');
    return JSON.parse(data);
  }
  return [];
}

// Save a new image log entry to the file
function saveImageLog(logEntry) {
  const logs = loadImageLog(IMAGE_LOG_FILE);
  logs.push(logEntry);
  fs.writeFileSync(IMAGE_LOG_FILE, JSON.stringify(logs, null, 2));
}

// Load mint log from file
function loadMintLog() {
  if (fs.existsSync(MINT_LOG_FILE)) {
    const data = fs.readFileSync(MINT_LOG_FILE, 'utf-8');
    return JSON.parse(data);
  }
  return [];
}

// Save a new mint log entry to the file
function saveMintLog(logEntry) {
  const logs = loadMintLog(MINT_LOG_FILE);
  logs.push(logEntry);
  fs.writeFileSync(MINT_LOG_FILE, JSON.stringify(logs, null, 2));
}

// Load user mints from file
function loadUserMints() {
  if (fs.existsSync(USER_MINT_FILE)) {
    const data = fs.readFileSync(USER_MINT_FILE, 'utf-8');
    return JSON.parse(data);
  }
  return {};
}

// Save a new mint for a user to the file
function saveUserMint(address, date) {
  const userMints = loadUserMints();
  userMints[address] = date; // Replace or create new entry
  fs.writeFileSync(USER_MINT_FILE, JSON.stringify(userMints, null, 2));
}

// Get the last mint date for a user
function lastMintForUser(address) {
  const userMints = loadUserMints();
  return userMints[address] || null; // Return the date if it exists, otherwise null
}

// Load replied tweet IDs from file
function loadRepliedTweets() {
  if (fs.existsSync(REPLIED_TWEETS_FILE)) {
    const data = fs.readFileSync(REPLIED_TWEETS_FILE, 'utf-8');
    return JSON.parse(data);
  }
  return [];
}

// Save a replied tweet ID to the file
function saveRepliedTweet(tweetId) {
  const repliedTweets = loadRepliedTweets();
  if (!repliedTweets.includes(tweetId)) {
    repliedTweets.push(tweetId);
    fs.writeFileSync(REPLIED_TWEETS_FILE, JSON.stringify(repliedTweets, null, 2));
  }
}

// Check if a tweet ID has been replied to
function hasRepliedToTweet(tweetId) {
  const repliedTweets = loadRepliedTweets();
  return repliedTweets.includes(tweetId);
}


module.exports = {
  loadThreadMappings,
  saveThreadMappings,
  getOpenAIThreadId,
  saveOpenAIThreadId,
  loadTrendingSummaries,
  saveTrendingSummaries,
  loadUserProfiles,
  saveUserProfiles,
  loadPersonalPrompts,
  savePersonalPrompts,
  loadImageLog,
  saveImageLog,
  loadMintLog,
  saveMintLog,
  loadUserMints,
  saveUserMint,
  lastMintForUser,
  loadRepliedTweets,
  saveRepliedTweet,
  hasRepliedToTweet,
};