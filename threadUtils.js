const fs = require('fs');
const path = require('path');

// Safe JSON parsing helper function
function safeJSONParse(data, filepath, defaultValue = {}) {
  try {
    return JSON.parse(data);
  } catch (error) {
    console.error(`❌ Error parsing JSON file ${filepath}:`, error.message);
    console.log(`🔧 Creating backup and resetting ${path.basename(filepath)}...`);
    
    // Create backup of corrupted file
    const backupFile = filepath + '.backup.' + Date.now();
    try {
      fs.copyFileSync(filepath, backupFile);
      console.log(`📁 Backup created: ${backupFile}`);
    } catch (backupError) {
      console.error('Failed to create backup:', backupError.message);
    }
    
    // Reset to default value
    try {
      fs.writeFileSync(filepath, JSON.stringify(defaultValue, null, 2));
      console.log(`✅ ${path.basename(filepath)} reset successfully`);
    } catch (writeError) {
      console.error('Failed to reset file:', writeError.message);
    }
    
    return defaultValue;
  }
}

const THREADS_FILE = path.resolve(__dirname, '../farcasterGPT-Data/threadMappings.json');
const RECENT_THREADS_FILE = path.resolve(__dirname, '../farcasterGPT-Data/recent_threads.json');
const TRENDING_SUMMARIES_FILE = path.resolve(__dirname, '../farcasterGPT-Data/trending_summaries.json');
const USER_PROFILES_FILE = path.resolve(__dirname, '../farcasterGPT-Data/userProfiles.json');
const PERSONAL_PROMPTS_FILE = path.resolve(__dirname, '../farcasterGPT-Data/personalPrompts.json');
const IMAGE_LOG_FILE = path.resolve(__dirname, '../farcasterGPT-Data/imageLog.json');
const MINT_LOG_FILE = path.resolve(__dirname, '../farcasterGPT-Data/mintLog.json');
const USER_MINT_FILE = path.resolve(__dirname, '../farcasterGPT-Data/userMint.json');
const REPLIED_TWEETS_FILE = path.resolve(__dirname, '../farcasterGPT-Data/repliedTweets.json');
const MEMED_TWEETS_FILE = path.resolve(__dirname, '../farcasterGPT-Data/memedTweets.json');
const NIFTY_THREADS_FILE = path.resolve(__dirname, '../farcasterGPT-Data/niftyThreads.json');



// Load existing thread mappings from file
function loadThreadMappings() {
  if (fs.existsSync(THREADS_FILE)) {
    const data = fs.readFileSync(THREADS_FILE, 'utf-8');
    return safeJSONParse(data, THREADS_FILE, {});
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
    return safeJSONParse(data, RECENT_THREADS_FILE, {});
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
    return safeJSONParse(data, TRENDING_SUMMARIES_FILE, []);
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
    return safeJSONParse(data, USER_PROFILES_FILE, {});
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
    return safeJSONParse(data, PERSONAL_PROMPTS_FILE, {});
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
    return safeJSONParse(data, IMAGE_LOG_FILE, []);
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
    return safeJSONParse(data, MINT_LOG_FILE, []);
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
    return safeJSONParse(data, USER_MINT_FILE, {});
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

// Load replied tweets from the file
function loadRepliedTweets() {
  if (fs.existsSync(REPLIED_TWEETS_FILE)) {
    const data = fs.readFileSync(REPLIED_TWEETS_FILE, 'utf-8');
    return safeJSONParse(data, REPLIED_TWEETS_FILE, []);
  }
  return [];
}

// Save a replied tweet with its threadId to the file
function saveRepliedTweet(tweetId, threadId) {
  const repliedTweets = loadRepliedTweets();
  
  // Check if the tweetId is already in the list
  const exists = repliedTweets.some(entry => entry.tweetId === tweetId);
  
  if (!exists) {
    repliedTweets.push({ tweetId, threadId });
    fs.writeFileSync(REPLIED_TWEETS_FILE, JSON.stringify(repliedTweets, null, 2));
  }
}

// Check if a tweet ID has been replied to
function hasRepliedToTweet(tweetId) {
  const repliedTweets = loadRepliedTweets();
  return repliedTweets.some(entry => entry.tweetId === tweetId);
}

// Get the threadId for a given tweetId
function threadIdForTweet(tweetId) {
  const repliedTweets = loadRepliedTweets();
  const entry = repliedTweets.find(entry => entry.tweetId === tweetId);
  return entry ? entry.threadId : null; // Return the threadId if found, otherwise null
}

// Load replied tweets from the file
function loadMemedTweets() {
  if (fs.existsSync(MEMED_TWEETS_FILE)) {
    const data = fs.readFileSync(MEMED_TWEETS_FILE, 'utf-8');
    return safeJSONParse(data, MEMED_TWEETS_FILE, []);
  }
  return [];
}

// Save a replied tweet with its threadId to the file
function saveMemedTweet(tweetId, threadId) {
  const repliedTweets = loadMemedTweets();
  
  // Check if the tweetId is already in the list
  const exists = repliedTweets.some(entry => entry.tweetId === tweetId);
  
  if (!exists) {
    repliedTweets.push(tweetId);
    fs.writeFileSync(MEMED_TWEETS_FILE, JSON.stringify(repliedTweets, null, 2));
  }
}

// Check if a tweet ID has been replied to
function hasMemedToTweet(tweetId) {
  const repliedTweets = loadRepliedTweets();
  return repliedTweets.some(entry => entry.tweetId === tweetId);
}

function loadNiftyThreads() {
  if (fs.existsSync(NIFTY_THREADS_FILE)) {
    const data = fs.readFileSync(NIFTY_THREADS_FILE, 'utf-8');
    return safeJSONParse(data, NIFTY_THREADS_FILE, {});
  }
  // Return an object here instead of an array
  return {};
}

function saveNiftyThread(username, threadId) {
  const niftyThreads = loadNiftyThreads();
  niftyThreads[username] = threadId;  // Store mapping of user -> threadId
  fs.writeFileSync(NIFTY_THREADS_FILE, JSON.stringify(niftyThreads, null, 2));
}

function getNiftyThreadForUser(username) {
  const niftyThreads = loadNiftyThreads();
  return niftyThreads[username] || null;
}

function hasNiftyThread(username) {
  const niftyThreads = loadNiftyThreads();
  return Object.prototype.hasOwnProperty.call(niftyThreads, username);
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
  loadMemedTweets,
  saveMemedTweet,
  hasMemedToTweet,
  threadIdForTweet,
  loadNiftyThreads,
  saveNiftyThread,
  getNiftyThreadForUser,
  hasNiftyThread,
};