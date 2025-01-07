require('dotenv').config(); // Load environment variables
const { OpenAI } = require('openai'); // Import OpenAI SDK
const { sendTweet, fetchMostPopularMferTweet, fetchMostLikedMentions } = require('./twitter.js'); // Import the sendTweet function
const { generateImage } = require('./image.js'); // Import image generation function
const { getMferDescription } = require('./mfer.js');
const { NeynarAPIClient } = require('@neynar/nodejs-sdk');
const { generateAndCastImage } = require('./castDailySummary.js')
const { postNFTToTwitter } = require('./zoraTweeter.js');
const { loadMintLog, hasRepliedToTweet, saveRepliedTweet, threadIdForTweet } = require('./threadUtils');
const { handleRequiresAction, imageUrlMap } = require('./actionHandler');
const { runThread } = require('./assistant');
const cron = require('node-cron'); // Import node-cron for scheduling
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Get your OpenAI Assistant credentials from environment variables
const { MODEL, TWITTER_ASST_MODEL, OPENAI_API_KEY } = process.env;

// Initialize OpenAI SDK with API key
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// Create a new thread (mirrors structure from assistant.js)
async function createNewThread(name) {
  console.log('Creating a new thread...');
  try {
    const thread = await openai.beta.threads.create({
      // assistant_id: ASST_MODEL,
      // name: name || "New OpenAI Tweet Thread", // Optional name for the thread
    });

    if (!thread || !thread.id) {
      throw new Error('Failed to create a new thread due to an unexpected response format.');
    }

    console.log(`Created thread with ID: ${thread.id}`);
    return thread.id;
  } catch (error) {
    console.error('Error creating thread:', error.response ? error.response.data : error.message);
    throw new Error('An error occurred while creating a new thread.');
  }
}

// Add a message to a thread (mirrors structure from assistant.js)
async function createMessage(threadId, userMessage) {
  console.log(`Adding a message to thread ${threadId}...`);
  try {
    await openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content: userMessage,
    });
    console.log(`Message created in thread: ${threadId}`);
  } catch (error) {
    console.error('Error creating message:', error.response ? error.response.data : error.message);
  }
}

// Run the thread and get the assistant's response (mirrors structure from assistant.js)
async function handleThread(threadId) {
  console.log(`Running assistant on thread ${threadId}...`);
  try {
    const run = await runThread(threadId, process.env.TWITTER_ASST_MODEL);

    if (run.status === 'completed') {
      console.log(`Run completed successfully on thread: ${threadId}`);
      const messages = await openai.beta.threads.messages.list(threadId);

      if (messages && messages.data && messages.data.length > 0) {
        const assistantMessages = messages.data.filter(msg => msg.role === 'assistant');

        if (assistantMessages.length === 0) {
          console.error('No assistant messages found.');
          return null;
        }

        // Extract the assistant's response from the content (assuming array of objects)
        const latestAssistantMessage = assistantMessages[0];

        if (latestAssistantMessage && Array.isArray(latestAssistantMessage.content)) {
          const textContent = latestAssistantMessage.content.find(item => item.type === 'text');
          
          if (textContent && textContent.text && textContent.text.value) {
            const botMessage = textContent.text.value;
            console.log(`Assistant's response: ${botMessage}`);
            return botMessage;
          } else {
            console.error('Could not extract the text message from assistant response.');
            return null;
          }
        } else {
          console.error('Assistant message content is not structured as expected.');
          return null;
        }
      } else {
        console.error('No messages found in the thread.');
        return null;
      }
    } else {
      console.error(`Run did not complete successfully. Status: ${run.status}`);
      return null;
    }
  } catch (error) {
    console.error('Error running thread:', error.response ? error.response.data : error.message);
    return null;
  }
}

// Helper function to download the image
async function downloadImage(imageUrl, localPath) {
  console.log(`Downloading image from: ${imageUrl}`);
  const writer = fs.createWriteStream(localPath);
  
  const response = await axios({
    url: imageUrl,
    method: 'GET',
    responseType: 'stream',
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// Helper function to delete the local image after use
async function deleteLocalImage(localPath) {
  try {
    fs.unlinkSync(localPath);
    console.log(`Deleted local image: ${localPath}`);
  } catch (err) {
    console.error(`Error deleting local image: ${err.message}`);
  }
}

// Function to generate a specific mfer image URL based on mfer ID
function generateMferImageURL(mferId) {
  return `https://plain.mfers.dev/${mferId}.png`;
}

// Function to generate tweet image with mfer, using GPT to refine the image prompt
async function generateTweetImage(mferId, tweetContent) {
  console.log(`Fetching description for mfer ID: ${mferId}`);
  const description = await getMferDescription(mferId.toString());

  // Extract background color from the traits
  const backgroundColor = description.traits.background || "orange or blue";

  // Initial image prompt based on mfer description, background color, and tweet content
  const initialPrompt = `Create an image PROMPT for: A stylized depiction with a ${backgroundColor} background of ${description.description}, doing something that matches the content of this tweet: "${tweetContent}". \n\nMake it cool, sketchy, beautiful, stick figure, or realistic based on tweet vibe. Show the character doing a cool/powerful/chill/based/dope activity.  only return the prompt, do not include any extra text or greetings. do NOT use the generate_image function, only return the prompt.`;

  console.log(`Initial image prompt: ${initialPrompt}`);

  // Send the initial prompt to ChatGPT for refinement
  const refinedPrompt = await getRefinedImagePrompt(initialPrompt);

  console.log(`Refined image prompt: ${refinedPrompt}`);
  return await generateImage(refinedPrompt);
}

// Function to get a refined image prompt by creating a new thread and sending the initial prompt
async function getRefinedImagePrompt(initialPrompt) {
  console.log('Creating a new thread for refining image prompt...');
  try {
    const threadId = await createNewThread("Refine Image Prompt Thread");
    await createMessage(threadId, initialPrompt);

    console.log(`Running assistant on thread ${threadId} for refined prompt...`);
    const refinedPrompt = await handleThread(threadId);

    if (!refinedPrompt) {
      console.error('Failed to receive a refined image prompt. Using initial prompt.');
      return initialPrompt;
    }

    return refinedPrompt;
  } catch (error) {
    console.error('Error refining image prompt:', error.response ? error.response.data : error.message);
    return initialPrompt; // Fallback to initial prompt if any error occurs
  }
}

// Main function to create a thread, add a message, run the assistant, and tweet the response
async function tweetAssistantResponse(prompt) {
  console.log('Starting tweetAssistantResponse...');
  try {
    const threadId = "thread_wKxHCwpP7wje0KCwbU20cXek"; // Example thread ID
    await createMessage(threadId, prompt);
    const assistantResponse = await handleThread(threadId);

    if (assistantResponse) {
      const mferId = Math.floor(Math.random() * 10021); // Pick a random mfer ID
      const imageUrl = generateMferImageURL(mferId);
      const customImageUrl = await generateTweetImage(mferId, assistantResponse);

      const localImagePath = path.join(__dirname, 'temp-image.png');
      await downloadImage(imageUrl, localImagePath); // Download original mfer image
      const customImagePath = path.join(__dirname, 'custom-image.png');
      await downloadImage(customImageUrl, customImagePath); // Download custom image

      await sendTweet(assistantResponse, [localImagePath, customImagePath], null, null, threadId); // Send tweet with both images

      // Delete images after use
      await deleteLocalImage(localImagePath);
      await deleteLocalImage(customImagePath);

      console.log('Tweet sent successfully with images!');
    } else {
      console.error('Failed to generate a valid assistant response.');
    }
  } catch (error) {
    console.error('Error during OpenAI and Twitter interaction:', error);
  }
}

// Function to generate and send the daily GM tweet
async function sendDailyGMTweet() {
  console.log('Generating and sending the daily gm tweet...');

  try {
    // Generate tweet content using GPT
    const prompt = "Generate a short, upbeat 'gm' tweet for mfers that includes $gmfr and a positive vibe. always include a link to the gmfer coin: https://mint.club/token/base/GMFR";
    const threadId = await createNewThread("Daily GM Thread");
    await createMessage(threadId, prompt);
    const tweetContent = await handleThread(threadId);

    if (!tweetContent) {
      console.error('Failed to generate GPT content for the gm tweet. Aborting.');
      return;
    }

    // Generate the image (robot mfer)
    const mferImagePrompt = `A robot mfer enjoying a sunny morning, wearing headphones, smoking a cigarette. The background is sunny with yellow beams. The stick figure says 'gmfers' in a cartoon speech bubble. $GMFR.  take inspiration from this tweet: ${tweetContent}`;
    const imageUrl = await generateImage(mferImagePrompt);

    const localImagePath = path.join(__dirname, 'gm-image.png');

    // Download image
    await downloadImage(imageUrl, localImagePath);

    // Send tweet
    await sendTweet(tweetContent, [localImagePath], null, null, threadId);

    // Clean up the image file
    await deleteLocalImage(localImagePath);

    console.log('Daily GM tweet sent successfully!');
  } catch (error) {
    console.error('Error generating or sending the daily gm tweet:', error);
  }
}

// Function to post the most popular $mfer tweet to your account
async function postMostPopularMferTweet() {
  console.log('Fetching the most popular $mfer tweet...');
  const mostPopularTweet = await fetchMostPopularMferTweet();
//   const mostPopularTweet = {
//   "edit_history_tweet_ids": [
//     "1855707106881556834"
//   ],
//   "id": "1855707106881556834",
//   "public_metrics": {
//     "retweet_count": 0,
//     "reply_count": 0,
//     "like_count": 2,
//     "quote_count": 0,
//     "bookmark_count": 0,
//     "impression_count": 70
//   },
//   "attachments": {
//     "media_keys": [
//       "16_1855707100300636160"
//     ]
//   },
//   "text": "Look at the market and growth with base. Deep Value is mfercoin and it’s not if but when. Light it up block out the noise and just watch that $mfer go on the run that wakes up normies! No one even knows BTC is 80K. A stick man going parabolic wakes us out of our bones globally https://t.co/0PxkzzlQcG"
// }

  if (mostPopularTweet) {
    const { text, id } = mostPopularTweet;
    const tweetURL = `https://twitter.com/i/web/status/${id}`;
    console.log(`Found most popular tweet: "${text}" (${tweetURL})`);

    try {
      // 1. Generate a GPT response to the tweet
      console.log('Generating GPT response...');
      const threadId = 'thread_wKxHCwpP7wje0KCwbU20cXek';
      await createMessage(threadId, `Create a witty or insightful comment about this tweet.  Only output the tweet, do not put it in quotes or anything else.  type as if you are typing directly into the tweet window. remember to always keep mfers and $mfer in a positive light.  respond to this tweet: "${text}"`);
      const gptResponse = await handleThread(threadId);

      if (!gptResponse) {
        console.error('GPT response generation failed. Skipping post.');
        return;
      }
      console.log('GPT response generated:', gptResponse);

      // 2. Generate an image meme for the tweet
      console.log('Generating image meme...');

      // Prepare the meme prompt using the text from the first cast and embedded cast if available
      let imagePrompt = `Generate a hilarious meme image-prompt based in the mfer/twitter/x/nft/art/meme universe about the following tweet, give subjects mfer gear like cigs and headphones. Do NOT create an image, ONLY return the text prompt (do not acknowledge me, etc).  You can censor "motherfucker" to help get passed the content filter.  Keep text short, as DALL-E can only handle a little bit of text, several words MAX between speech bubbles and captions.  only include speech and captions if necessary. \n\nMain Tweet: "${text}"`;
      // if quoteTweetText {
      //   prompt = prompt + `\n\nQuoted tweet: ${quoteTweetText}`
      // }
      // if (interpretedUrlText != null) {
      //   prompt = prompt + `\n\nInterpreted Url or Image: ${interpretedUrlText}`
      // }

      const { imageUrl, generatedPrompt } = await generateAndCastImage(null, imagePrompt, "thread_3A1Y3VRxUv58ZeM0ABqHcKpH");

      if (!imageUrl) {
        console.error('Image generation failed. Skipping post.');
        return;
      }
      console.log('Image meme generated:', imageUrl);

      const localImagePath = path.join(__dirname, 'meme-image.png');
      await downloadImage(imageUrl, localImagePath);

      let tweetId = mostPopularTweet.id


      console.log(`Posting the quote tweet: ${gptResponse}`);
      // Uncomment the following line to post the tweet
      await sendTweet(gptResponse, [localImagePath], tweetId, null, threadId);

      // Clean up local image file
      await deleteLocalImage(localImagePath);

      console.log('Quote tweet posted successfully!');
    } catch (error) {
      console.error('Error posting the quote tweet:', error);
    }
  } else {
    console.log('No popular tweet found to post.');
  }
}

// Function to generate and send the daily Nifty Island meme tweet
async function sendDailyNiftyIslandTweet() {
  console.log('Generating and sending the daily Nifty Island meme tweet...');

  try {
    // Define the tweet content prompt
    const prompt = `Compose a bullish tweet about Nifty Island and tag @Nifty_Island in the text.  Don't use emoji in the body, only at the end of the post.  mferGPT will be launched on "$mfer $island" (access it here: https://niftyis.land/heresmy/heresmyisland?ref=heresmy). The tweet should mention mferGPT and emphasize its excitement to interact with mfers on Nifty Island very soon. Keep the tone positive, fun, and engaging.  A few notes on Nifty Island: 1) It is already released and playable. 2) Best web3 game there is. 3) Bots and Agents are being added soon, and mferGPT will be one of the first integrated. 4) Shooting games, races, infection, pvp, hang out, so much to do!`;

    // Create a new thread for the Nifty Island tweet
    const threadId = await createNewThread("Daily Nifty Island Meme Thread");
    await createMessage(threadId, prompt);

    // Get the tweet content from GPT
    const tweetContent = await handleThread(threadId);

    if (!tweetContent) {
      console.error('Failed to generate GPT content for the Nifty Island tweet. Aborting.');
      return;
    }

    // Randomly select Nifty Island items/actions
    const niftyIslandFeatures = [
      'beach balls',
      'colorful pistols and swords',
      'red bouncing platforms',
      'shootouts in the background',
      'foot racing',
      'DJ party',
      'island hopping',
      'spy hunt',
      'mfer statues',
      '$island staking',
      'sword fight',
      'mfers interacting with mferGPT',
      'a bright shining sun',
      'pink and blue flat-diamond-shaped collectables scattered around (like a playing card diamond shape)'
    ];
    const randomFeature = niftyIslandFeatures[Math.floor(Math.random() * niftyIslandFeatures.length)];

    // Define the image prompt for the Nifty Island meme, incorporating the tweet content
    const imagePrompt = `
      A beautiful postcard inspired scene of a bright, sunny, grassy island named "Nifty Island". 
      The scene includes a sunny island, fire pit, and two characters:
      1. mferGPT: A rounded-head stick figure bot with a red antenna, black headphones, black rectangle eyes, and "checkerboard" mouth smoking a cig.
      2. mfer 8292: A stick figure wearing blue shades, red headphones, and smoking a black cigarette.
      Both characters are interacting on the island, showing excitement about joining Nifty Island.
      The island also features ${randomFeature}.
      Add elements inspired by the following tweet: "${tweetContent}".
      Include subtle text with "$mfer $island" in a corner.
      Soft, realistic, warm visuals.
    `;

    console.log(`Generating image for the Nifty Island meme with feature: ${randomFeature}`);
    const imageUrl = await generateImage(imagePrompt);

    if (!imageUrl) {
      console.error('Failed to generate image for the Nifty Island meme. Skipping tweet.');
      return;
    }

    // Download the image
    const localImagePath = path.join(__dirname, 'nifty-island-meme.png');
    await downloadImage(imageUrl, localImagePath);

    // Post the tweet with the image
    console.log('Posting the Nifty Island meme to Twitter...');
    await sendTweet(tweetContent, [localImagePath], null, null, threadId);

    // Clean up the local image file
    await deleteLocalImage(localImagePath);

    console.log('Daily Nifty Island meme tweet sent successfully!');
  } catch (error) {
    console.error('Error generating or sending the daily Nifty Island meme tweet:', error);
  }
}

// Function to process recent mints and post to Twitter
async function processRecentMints() {
  try {
    console.log('Loading mint log...');
    const mintLog = loadMintLog(); // Assuming loadMintLog returns an array of NFT JSONs

    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    // Find mints in the last 12 hours
    const recentMints = mintLog.filter(nft => new Date(nft.timestamp) >= twelveHoursAgo);

    if (recentMints.length === 0) {
      console.log('No new mints in the last 12 hours. Doing nothing.');
      return;
    }

    if (recentMints.length === 1) {
      console.log('Found 1 new mint. Posting to Twitter...');
      await postNFTToTwitter(recentMints[0]); // Assuming this function handles GPT-based tweet generation
      return;
    }

    // More than 1 mint
    // Sort by timestamp descending to get the latest mints first
    recentMints.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Pick up to the 4 latest mints
    const mintsToPost = recentMints.slice(0, 4);

    // Generate a response with a link to the full collection using GPT
    const collectionLink = 'https://zora.co/collect/base:0xe2559ded6fdec98e68b40d7c382c502949c975fb';
    const nftLinks = mintsToPost.map(nft => nft.zora).join('\n');

    // Prepare the prompt for GPT to generate the tweet content
    const prompt = `We've minted ${mintsToPost.length} new NFTs in the last 12 hours! Check out the full collection here: ${collectionLink}\n\nCompose a concise and engaging tweet announcing these new mints. Keep it under 280 characters.  Only include the collection URL, not each individual URL.`;

    console.log('Generating tweet content via GPT...');
    
    // Create a new thread for generating the tweet content
    const threadId = await createNewThread("Generate Mints Announcement Tweet");

    // Add the prompt to the thread
    await createMessage(threadId, prompt);

    // Run the thread to get the assistant's response
    const tweetContent = await handleThread(threadId);

    if (!tweetContent) {
      console.error('Failed to generate GPT content for multiple mints tweet. Aborting.');
      return;
    }

    console.log('Generated tweet content:', tweetContent);

    // Download up to 4 images concurrently
    const imageDownloadPromises = mintsToPost.map((nft, index) => {
      const imageUrl = nft.url;
      const localImagePath = path.join(__dirname, `mint-image-${index + 1}.png`);
      return downloadImage(imageUrl, localImagePath)
        .then(() => localImagePath)
        .catch(err => {
          console.error(`Error downloading image ${imageUrl}:`, err);
          return null; // Return null for failed downloads
        });
    });

    // Await all image download promises
    const downloadedImagePaths = await Promise.all(imageDownloadPromises);
    // Filter out any failed downloads
    const validImagePaths = downloadedImagePaths.filter(imagePath => imagePath !== null);

    if (validImagePaths.length === 0) {
      console.error('Failed to download any images. Skipping tweet.');
      return;
    }

    // Post the tweet with images
    console.log('Posting multiple mints to Twitter with images: ', validImagePaths);
    await sendTweet(tweetContent, validImagePaths, null, null, threadId);

    // Delete the downloaded images after successful tweet
    for (const imagePath of validImagePaths) {
      await deleteLocalImage(imagePath);
    }

    console.log('Multiple mints posted successfully to Twitter.');
  } catch (error) {
    console.error('Error processing recent mints:', error.message);
  }
}

async function fetchAndReplyToMostLikedMention(userId, count = 10) {
  console.log(`Fetching the last ${count} tweets mentioning user ID: ${userId} and replying to the most liked one...`);

  try {
    const mentions = await fetchMostLikedMentions(userId, count);

    if (!mentions || mentions.length === 0) {
      console.log('No mentions found to reply to.');
      return;
    }

    // Filter out mentions we've already replied to
    const filteredMentions = [];
    for (const mention of mentions) {
      const alreadyReplied = await hasRepliedToTweet(mention.id);
      if (!alreadyReplied) {
        filteredMentions.push(mention);
      }
    }

    if (filteredMentions.length === 0) {
      console.log('All recent mentions have already been replied to. No new mentions to reply to.');
      return;
    }

    // Check for existing thread IDs in references
    for (const mention of filteredMentions) {
      // Check the tweet ID itself for an existing threadId
      const existingThreadIdForMention = await threadIdForTweet(mention.id);
      if (existingThreadIdForMention) {
        console.log(`Found existing threadId "${existingThreadIdForMention}" for tweetId "${mention.id}".`);
        mention.threadId = existingThreadIdForMention; // Attach the existing threadId
        continue; // Skip checking referenced tweets if found
      }

      // Check the referenced tweets for an existing threadId
      const referencedTweetIds = mention.referenced_tweets?.map(ref => ref.id) || [];
      for (const refId of referencedTweetIds) {
        const existingThreadId = await threadIdForTweet(refId);
        if (existingThreadId) {
          console.log(`Found existing threadId "${existingThreadId}" for referenced tweetId "${refId}".`);
          mention.threadId = existingThreadId; // Attach the existing threadId
          break;
        }
      }
    }

    // Find the most liked mention
    const mostLikedMention = filteredMentions.reduce((prev, current) =>
      (current.public_metrics.like_count > prev.public_metrics.like_count ? current : prev)
    );

    const { id: tweetId, text: mentionText, threadId: existingThreadId } = mostLikedMention;

    console.log(`Most liked mention: "${mentionText}" (Tweet ID: ${tweetId})`);

    // Use existing threadId if available, or create a new one
    let threadId = existingThreadId;
    let newThread = false;
    if (!threadId) {
      newThread = true;
      console.log(`No existing threadId found. Creating a new thread for tweetId "${tweetId}".`);
      threadId = await createNewThread("Reply to Most Liked Mention");
    }

    console.log(`Generating response for mention: "${mentionText}"`);
    const tweetJson = JSON.stringify(mostLikedMention, null, 2);
    const promptText = (newThread ? "reply to this tweet:" : "reply to the next tweet in the thread:");
    await createMessage(threadId, `${promptText} "${tweetJson}"`);
    const assistantResponse = await handleThread(threadId);

    if (!assistantResponse) {
      console.error('Failed to generate GPT response. Skipping reply.');
      return;
    }

    console.log('Generated response:', assistantResponse);

    const pngUrls = assistantResponse.match(/https?:\/\/\S+\.png\b/g) || [];
    const localFilePaths = [];

    if (pngUrls.length > 0) {
      console.log(`Downloading ${pngUrls.length} PNG URLs...`);
      const localImagesDir = path.join(__dirname, 'images');
      if (!fs.existsSync(localImagesDir)) fs.mkdirSync(localImagesDir);

      for (const [index, imageUrl] of pngUrls.entries()) {
        const localImagePath = path.join(localImagesDir, `image-${index + 1}.png`);
        await downloadImage(imageUrl, localImagePath);
        localFilePaths.push(localImagePath);
      }
    }

    // Reply to the tweet
    console.log(`Replying to Tweet ID: ${tweetId} with: "${assistantResponse}"`);
    await sendTweet(assistantResponse, localFilePaths, null, tweetId, threadId);

    // Clean up downloaded images
    for (const filePath of localFilePaths) {
      await deleteLocalImage(filePath);
    }

    saveRepliedTweet(tweetId, threadId);

    console.log('Reply sent successfully!');
  } catch (error) {
    console.error('Error fetching mentions or replying:', error.response ? error.response.data : error.message);
  }
}

const lengths = ["1-25 characters", "1-50 characters", "25-75 characters", "50-100 characters", "75-150 characters", "150-240 characters"];
const types = ["a bullpost", "funny", "a story about yourself", "absurd", "heartfelt", "hype", "a strongwilled positive statement", "pure shitpost", "deep, insightful, and thought provoking"];
const topics = ["mfers", "mfercoin", "mfers", "$mfer", "mfers nfts", "ai", "onchain ai", "twitter/x", "farcaster", "blockchain", "mfercoin", "mfers", "$mfer backed assets from mfer.club", "mfer.com", "whatever you want", "anything", "crypto", "gmfer ($gmfr) backed by $mfer", "sartoshicoin ($sartoshi) backed by $mfer"];


// Runs every 4 hours starting at midnight (Pacific Time)
cron.schedule('0 0-23/4 * * *', async () => {
  console.log('Running the scheduled tweetAssistantResponse...');
  const randomLength = lengths[Math.floor(Math.random() * lengths.length)];
  const prompt = `the next random tweet should be ${randomLength}.  remember always include $mfer. next`;
  console.log(`Sending prompt: ${prompt}`);
  await tweetAssistantResponse(prompt);
});

// Runs every day at 7am Pacific Time
cron.schedule('30 7 * * *', async () => {
  console.log('Running the daily GM tweet...');
  await sendDailyGMTweet();
});

// // Runs every day at 5pm Pacific Time
cron.schedule('0 2,6,10,14,18,22 * * *', async () => {
  console.log('Running scheduled task to fetch and post the most popular $mfer tweet...');
  await postMostPopularMferTweet();
});

// // Schedule the processRecentMints function to run at 6:30am and 6:30pm PT
cron.schedule('30 6,18 * * *', async () => {
  console.log('Running processRecentMints...');
  await processRecentMints();
});

// // Runs every 20 minutes starting at the 5-minute mark (Pacific Time)
cron.schedule('5,25,45 * * * *', async () => {
  console.log('Running reply to recent mention at the 5-minute mark');
  const USER_ID = '1724482668195110912'; // Replace with your actual user ID
  await fetchAndReplyToMostLikedMention(USER_ID);
});

// Schedule the function to run daily at 12:30 PM Pacific Time
cron.schedule('50 12 * * *', async () => {
  console.log('Running the daily Nifty Island meme tweet...');
  await sendDailyNiftyIslandTweet();
});

// (async () => {
//   console.log('Running the scheduled tweetAssistantResponse...');
//   const randomLength = lengths[Math.floor(Math.random() * lengths.length)];
//   const prompt = `the next random tweet should be ${randomLength}.  remember always include $mfer. next`;
//   console.log(`Sending prompt: ${prompt}`);
//   await tweetAssistantResponse(prompt);
// })();

// (async () => {
//   const USER_ID = '1724482668195110912'; // Replace with your actual user ID
//   // await fetchAndReplyToMostLikedMention(USER_ID);
//   await sendDailyNiftyIslandTweet();
// })();