#!/usr/bin/env node
/**
 * testCrons.js - Test harness for all cron job functions
 * 
 * Calls the ACTUAL production functions but mocks sendTweet/publishPost
 * to display output instead of actually posting.
 * 
 * Usage:
 *   node testCrons.js <command> [options]
 */

require('dotenv').config();

// ============================================================================
// STEP 1: Mock sendTweet in twitter.js BEFORE it gets imported by tweet.js
// ============================================================================

// Disable cron jobs from running during tests
const cron = require('node-cron');
const originalSchedule = cron.schedule;
cron.schedule = () => ({ stop: () => {} }); // No-op cron scheduling

const twitterModule = require('./twitter.js');
const originalSendTweet = twitterModule.sendTweet;

// Replace with mock version
twitterModule.sendTweet = async function mockSendTweet(text, imagePaths = [], quoteTweetId = null, replyTweetId = null, openAIThreadId = null) {
  console.log('\n' + '='.repeat(60));
  console.log('🐦 DRY RUN - TWEET WOULD BE SENT:');
  console.log('='.repeat(60));
  console.log('\n📝 Tweet Text:');
  console.log('-'.repeat(40));
  console.log(text);
  console.log('-'.repeat(40));
  console.log(`\n📊 Character count: ${text.length}/280`);
  
  if (imagePaths && imagePaths.length > 0) {
    console.log(`\n🖼️  Images (${imagePaths.length}):`);
    imagePaths.forEach((img, i) => {
      console.log(`   ${i + 1}. ${img}`);
    });
  }
  
  if (quoteTweetId) {
    console.log(`\n🔗 Quote Tweet ID: ${quoteTweetId}`);
    console.log(`   URL: https://twitter.com/i/web/status/${quoteTweetId}`);
  }
  
  if (replyTweetId) {
    console.log(`\n↩️  Reply to Tweet ID: ${replyTweetId}`);
  }
  
  if (openAIThreadId) {
    console.log(`\n🧵 OpenAI Thread ID: ${openAIThreadId}`);
  }
  
  console.log('='.repeat(60) + '\n');
  
  return { data: { id: 'dry-run-tweet-' + Date.now() } };
};

// ============================================================================
// STEP 2: Mock neynarClient.publishCast for Farcaster casts
// ============================================================================

const { neynarClient } = require('./client.js');

// ============================================================================
// STEP 2.5: Mock generateImage to avoid actual API calls
// ============================================================================

const imageModule = require('./image.js');
const originalGenerateImage = imageModule.generateImage;

imageModule.generateImage = async function mockGenerateImage(prompt) {
  console.log('\n📸 DRY RUN - Image generation would be called with prompt:');
  console.log(`   "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`);
  // Return a placeholder image URL for dry run
  return 'https://cybermfers.sfo3.digitaloceanspaces.com/cybermfers/public/assets/png/1874.png';
};
let castCount = 0;

neynarClient.publishCast = async function mockPublishCast(signerUuid, text, options = {}) {
  castCount++;
  console.log('\n' + '='.repeat(60));
  console.log(`📣 DRY RUN - FARCASTER CAST #${castCount} WOULD BE SENT:`);
  console.log('='.repeat(60));
  console.log('\n📝 Cast Text:');
  console.log('-'.repeat(40));
  console.log(text);
  console.log('-'.repeat(40));
  console.log(`\n📊 Byte count: ${Buffer.byteLength(text, 'utf8')}/768`);
  
  if (options.embeds && options.embeds.length > 0) {
    console.log('\n🔗 Embeds:');
    options.embeds.forEach((embed, i) => {
      if (embed.url) console.log(`   ${i + 1}. Image URL: ${embed.url}`);
      if (embed.cast_id) console.log(`   ${i + 1}. Cast embed: hash=${embed.cast_id.hash}, fid=${embed.cast_id.fid}`);
    });
  }
  
  if (options.replyTo) {
    console.log(`\n↩️  Reply to: ${options.replyTo}`);
  }
  
  if (options.channelId) {
    console.log(`\n📺 Channel: ${options.channelId}`);
  }
  
  console.log('='.repeat(60) + '\n');
  
  return { hash: 'dry-run-cast-' + Date.now() };
};

// ============================================================================
// STEP 3: Now import the modules that use the mocked functions
// ============================================================================

// Import tweet.js functions (these will use the mocked sendTweet)
const {
  sendMferOfTheDay,
  sendDailyGMTweet,
  postMostPopularMferTweet,
  processRecentMints,
  fetchAndReplyToMostLikedMention,
  sendDailyNiftyIslandTweet,
} = require('./tweet.js');

// Import Farcaster functions (these will use the mocked publishCast)
const { 
  castDailySummary, 
  castTrendingSummary, 
  castDailyMeme,
} = require('./castDailySummary.js');

// ============================================================================
// Help text
// ============================================================================

function showHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    🧪 CRON JOB TESTER                        ║
╠══════════════════════════════════════════════════════════════╣
║  All tests run in DRY_RUN mode - no tweets/casts are sent!   ║
║  This calls the ACTUAL production functions.                 ║
╚══════════════════════════════════════════════════════════════╝

Usage: node testCrons.js <command> [options]

Twitter Commands (from tweet.js):
  mfer-of-the-day     Test sendMferOfTheDay() - 8am PT
  gm                  Test sendDailyGMTweet() - 7:30am PT  
  quote-tweet [term]  Test postMostPopularMferTweet() - 4x daily
  recent-mints        Test processRecentMints() - 6:30am/pm PT
  reply-mentions      Test fetchAndReplyToMostLikedMention() - every 20 min
  nifty-island        Test sendDailyNiftyIslandTweet() - 12:30pm PT

Farcaster Commands (from castDailySummary.js):
  daily-summary       Test castDailySummary() - 4pm PT
  trending-summary    Test castTrendingSummary() - 7am PT
  daily-meme          Test castDailyMeme() - every 6 hours

Other:
  list / help         Show this help message

Examples:
  node testCrons.js mfer-of-the-day
  node testCrons.js quote-tweet ethereum
  node testCrons.js daily-meme
`);
}

// ============================================================================
// Main CLI Handler
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();
  
  if (!command || command === 'help' || command === 'list') {
    showHelp();
    return;
  }
  
  // Set a global timeout to prevent infinite hangs (5 minutes)
  const globalTimeout = setTimeout(() => {
    console.error('\n❌ Global timeout reached (5 minutes). Exiting...');
    process.exit(1);
  }, 300000);
  
  console.log('\n🧪 DRY RUN MODE - No actual tweets/casts will be sent');
  console.log('📦 Calling ACTUAL production functions\n');
  
  try {
    switch (command) {
      case 'mfer-of-the-day':
      case 'mferoftheday':
      case 'motd':
        console.log('🎨 Executing: sendMferOfTheDay()\n');
        await sendMferOfTheDay();
        break;
        
      case 'gm':
      case 'daily-gm':
        console.log('☀️ Executing: sendDailyGMTweet()\n');
        await sendDailyGMTweet();
        break;
        
      case 'quote-tweet':
      case 'quote': {
        const searchTerm = args[1] || 'mfercoin';
        console.log(`💬 Executing: postMostPopularMferTweet("${searchTerm}")\n`);
        await postMostPopularMferTweet(searchTerm);
        break;
      }
        
      case 'recent-mints':
      case 'mints':
        console.log('🎨 Executing: processRecentMints()\n');
        await processRecentMints();
        break;
        
      case 'reply-mentions':
      case 'mentions':
      case 'reply': {
        const USER_ID = '1724482668195110912';
        console.log(`💬 Executing: fetchAndReplyToMostLikedMention("${USER_ID}")\n`);
        await fetchAndReplyToMostLikedMention(USER_ID);
        break;
      }
        
      case 'nifty-island':
      case 'nifty':
        console.log('🏝️ Executing: sendDailyNiftyIslandTweet()\n');
        await sendDailyNiftyIslandTweet();
        break;
        
      case 'daily-summary':
      case 'summary':
        console.log('📊 Executing: castDailySummary()\n');
        await castDailySummary();
        break;
        
      case 'trending-summary':
      case 'trending':
        console.log('📈 Executing: castTrendingSummary()\n');
        await castTrendingSummary();
        break;
        
      case 'daily-meme':
      case 'meme':
        console.log('😂 Executing: castDailyMeme()\n');
        await castDailyMeme();
        break;
        
      default:
        console.log(`❌ Unknown command: ${command}`);
        showHelp();
        clearTimeout(globalTimeout);
        return;
    }
    
    clearTimeout(globalTimeout);
    console.log('\n✅ Test completed successfully!\n');
    process.exit(0);
    
  } catch (error) {
    clearTimeout(globalTimeout);
    console.error('\n❌ Test failed with error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();

