const fs = require('fs');
const path = require('path');

const THREADS_FILE = path.resolve(__dirname, 'threadMappings.json');

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

// Retrieve OpenAI thread ID by Farcaster thread ID
function getOpenAIThreadId(farcasterThreadId) {
  const mappings = loadThreadMappings();
  return mappings[farcasterThreadId];
}

// Save the mapping of Farcaster thread to OpenAI thread
function saveOpenAIThreadId(farcasterThreadId, openAIThreadId) {
  const mappings = loadThreadMappings();
  mappings[farcasterThreadId] = openAIThreadId;
  saveThreadMappings(mappings);
}

module.exports = { loadThreadMappings, saveThreadMappings, getOpenAIThreadId, saveOpenAIThreadId };