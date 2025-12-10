// zoraTweeter.js

require('dotenv').config();
const axios = require('axios');
const { openai, neynarClient } = require('./client'); // For OpenAI and Farcaster
const { sendTweet } = require('./twitter'); // Assuming twitter.js is in the same directory
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// Function to post NFT to Farcaster
async function postNFTToFarcaster(nftJson) {
  try {
    const { url, zora, name, description, artist } = nftJson;

    // Use Assistant's Beta API to generate the post content
    const userMessageObject = {
      instructions: [
        "Create a brief and engaging description for the following NFT to post on Farcaster.",
        "Include the name, artist, and description, and encourage viewers to check it out on Zora (include the URL)."
      ],
      data: {
        name: name,
        artist: artist,
        description: description,
        zoraUrl: zora
      }
    };

    const userMessage = JSON.stringify(userMessageObject, null, 2);

    // Create a new thread
    const thread = await openai.beta.threads.create();

    console.log("creating openAI message...")

    // Create a message in the thread
    await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: userMessage,
    });

    console.log("running openAI message...")

    // Run the Assistant on the thread
    const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: process.env.ASST_MODEL,
      model: process.env.MODEL,
    });

    let assistantResponse = 'Check out this amazing NFT!';

    if (run.status === 'completed') {
      const messages = await openai.beta.threads.messages.list(run.thread_id);
      const assistantMessages = messages.data.filter(msg => msg.role === 'assistant');
      if (assistantMessages.length > 0) {
        assistantResponse = assistantMessages[0].content[0].text.value;
      }
    } else {
      console.error(`Run did not complete successfully. Status: ${run.status}`);
    }

    // Construct the Farcaster post content
    const farcasterMessage = `${assistantResponse}\n\n${zora}`;

    // Post to Farcaster with image
    await neynarClient.publishCast(process.env.SIGNER_UUID, farcasterMessage, {
      channelId: "mfergpt",
      embeds: [{ url }],
    });

    console.log(`Successfully posted NFT to Farcaster: ${farcasterMessage}`);
  } catch (error) {
    console.error('Error posting NFT to Farcaster:', error.message);
  }
}

// Function to post NFT to Twitter
async function postNFTToTwitter(nftJson) {
  try {
    const { url, zora, name, description, artist } = nftJson;

    // Use Assistant's Beta API to generate the tweet content
    const userMessageObject = {
      instructions: [
        "Create a brief and engaging tweet for the following NFT that was just created on your zora mferGPT art contract.",
        "Include the name, artist, and description, and encourage viewers to mint it on Zora (include the URL).",
        "no emoji."
      ],
      data: {
        name: name,
        artist: artist,
        description: description,
        zoraUrl: zora
      }
    };

    const userMessage = JSON.stringify(userMessageObject, null, 2);

    // Create a new thread
    const thread = await openai.beta.threads.create();

    // Create a message in the thread
    await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: userMessage,
    });

    // Run the Assistant on the thread
    const assistantModel = process.env.ASST_MODEL;
    console.log(`[TWITTER] Using assistant model: ${assistantModel} for postNFTToTwitter`);
    const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: assistantModel,
      model: process.env.MODEL,
    });

    let assistantResponse = 'Check out this amazing NFT!';

    if (run.status === 'completed') {
      const messages = await openai.beta.threads.messages.list(run.thread_id);
      const assistantMessages = messages.data.filter(msg => msg.role === 'assistant');
      if (assistantMessages.length > 0) {
        assistantResponse = assistantMessages[0].content[0].text.value;
      }
    } else {
      console.error(`Run did not complete successfully. Status: ${run.status}`);
    }

    // Download the image to a temporary location
    const imagePath = await downloadImage(url);

    // Construct the tweet content
    const tweetContent = `${assistantResponse}\n\n${zora}`;

    // Post to Twitter with image
    await sendTweet(tweetContent, [imagePath], null, null, thread.id);

    // Delete the temporary image file
    fs.unlinkSync(imagePath);

    console.log('Successfully posted NFT to Twitter: ', tweetContent);
  } catch (error) {
    console.error('Error posting NFT to Twitter:', error.message);
  }
}

// Helper function to download image locally
async function downloadImage(imageUrl) {
  const imagePath = path.resolve(__dirname, 'temp_image.png');
  const writer = fs.createWriteStream(imagePath);

  const response = await axios({
    url: imageUrl,
    method: 'GET',
    responseType: 'stream',
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(imagePath));
    writer.on('error', reject);
  });
}

module.exports = {
  postNFTToFarcaster,
  postNFTToTwitter,
};

// (async () => {
//     // Example NFT JSON
//     const nftJson = [
//       {
//         timestamp: '2024-11-17T23:11:21.084Z',
//         url: 'https://iili.io/2A47XoB.png',
//         zora: 'https://zora.co/collect/base:0x339563f98180dda919b9efc56f4f74c2e0b68dd0/73',
//         name: 'new test',
//         description: 'A unique digital artwork representing the fusion of technology and creativity.',
//         artist: 'Test Artist',
//       },
//     ];

//     // Test posting to Farcaster
//     console.log('Testing postNFTToFarcaster with sample NFT data...');
//     await postNFTToTwitter(nftJson);
//   })();