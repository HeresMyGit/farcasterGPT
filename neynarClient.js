const { NeynarAPIClient } = require('@neynar/nodejs-sdk');
require('dotenv').config();


if (!process.env.NEYNAR_API_KEY) {
  throw new Error('Make sure you set NEYNAR_API_KEY in your .env file');
}

const neynarClient = new NeynarAPIClient(process.env.NEYNAR_API_KEY);

module.exports = neynarClient;