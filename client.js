// clients.js

require('dotenv').config();
const { NeynarAPIClient } = require('@neynar/nodejs-sdk');
const OpenAI = require('openai');

// Initialize Neynar client
const neynarClient = new NeynarAPIClient(process.env.NEYNAR_API_KEY);

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG,
});

module.exports = { neynarClient, openai };
