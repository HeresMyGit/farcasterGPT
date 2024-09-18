const fs = require('fs');
const path = require('path');

const THREADS_FILE = path.resolve(__dirname, '../farcasterGPT-Data/threadMappings.json');
const RECENT_THREADS_FILE = path.resolve(__dirname, '../farcasterGPT-Data/recent_threads.json');
const TRENDING_SUMMARIES_FILE = path.resolve(__dirname, '../farcasterGPT-Data/trending_summaries.json');
const USER_PROFILES_FILE = path.resolve(__dirname, '../farcasterGPT-Data/userProfiles.json');

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

module.exports = {
  loadThreadMappings,
  saveThreadMappings,
  getOpenAIThreadId,
  saveOpenAIThreadId,
  loadTrendingSummaries,
  saveTrendingSummaries,
  loadUserProfiles,
  saveUserProfiles,
};