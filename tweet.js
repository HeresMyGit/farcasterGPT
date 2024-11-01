require('dotenv').config(); // Load environment variables
const { OpenAI } = require('openai'); // Import OpenAI SDK
const { sendTweet } = require('./twitter.js'); // Import the sendTweet function
const { generateImage } = require('./image.js'); // Import image generation function
const { getMferDescription } = require('./mfer.js');
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
async function runThread(threadId) {
  console.log(`Running assistant on thread ${threadId}...`);
  try {
    const run = await openai.beta.threads.runs.createAndPoll(threadId, {
      assistant_id: TWITTER_ASST_MODEL,
      model: MODEL,
    });

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
  const initialPrompt = `A stylized depiction with a ${backgroundColor} background of ${description.description}, doing something that matches the content of this tweet: "${tweetContent}". \n\nMake it cool, sketchy, beautiful, stick figure, or realistic based on tweet vibe. Show the character doing a cool/powerful/chill/based/dope activity.  only return the prompt, do not include any extra text or greetings.`;

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
    const refinedPrompt = await runThread(threadId);

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
    const threadId = "thread_FPHRJSjuJjRWm2pAKOVExB7a"; // Example thread ID
    await createMessage(threadId, prompt);
    const assistantResponse = await runThread(threadId);

    if (assistantResponse) {
      const mferId = Math.floor(Math.random() * 10021); // Pick a random mfer ID
      const imageUrl = generateMferImageURL(mferId);
      const customImageUrl = await generateTweetImage(mferId, assistantResponse);

      const localImagePath = path.join(__dirname, 'temp-image.png');
      await downloadImage(imageUrl, localImagePath); // Download original mfer image
      const customImagePath = path.join(__dirname, 'custom-image.png');
      await downloadImage(customImageUrl, customImagePath); // Download custom image

      await sendTweet(assistantResponse, [localImagePath, customImagePath]); // Send tweet with both images

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

const lengths = ["1-25 characters", "1-50 characters", "25-75 characters", "50-100 characters", "75-150 characters", "150-240 characters"];
const types = ["a bullpost", "funny", "a story about yourself", "absurd", "heartfelt", "hype", "a strongwilled positive statement", "pure shitpost", "deep, insightful, and thought provoking"];
const topics = ["mfers", "mfercoin", "mfers", "$mfer", "mfers nfts", "ai", "onchain ai", "twitter/x", "farcaster", "blockchain", "mfercoin", "mfers", "$mfer backed assets from mfer.club", "mfer.com", "whatever you want", "anything", "crypto", "gmfer ($gmfr) backed by $mfer", "sartoshicoin ($sartoshi) backed by $mfer"];

// Example usage of the function
// (async () => {
//   const randomLength = lengths[Math.floor(Math.random() * lengths.length)];
//   // const randomType = types[Math.floor(Math.random() * types.length)];
//   // const randomTopic = topics[Math.floor(Math.random() * topics.length)];
//   const prompt = `the next tweet should be ${randomLength}.  remember always include $mfer. next`;
//     console.log(`Sending prompt: ${prompt}`);
//   // const imgPrompt = "a stick figure smoking a cigarette"
//   await tweetAssistantResponse(prompt);
// })();

// cron.schedule('0,30 * * * *', async () => {
//   console.log('Running the scheduled tweetAssistantResponse...');
//   const prompt = 'next';
//   await tweetAssistantResponse(prompt);
// });


// run every 2 hours starting at midnight
cron.schedule('0 */2 * * *', async () => {
  console.log('Running the scheduled tweetAssistantResponse...');
  const randomLength = lengths[Math.floor(Math.random() * lengths.length)];
  // const randomType = types[Math.floor(Math.random() * types.length)];
  // const randomTopic = topics[Math.floor(Math.random() * topics.length)];
  const prompt = `the next tweet should be ${randomLength}.  remember always include $mfer. next`;
  console.log(`Sending prompt: ${prompt}`);
  await tweetAssistantResponse(prompt);
});

// cron.schedule('0,30 * * * *', async () => {
//   console.log('Running the scheduled tweetAssistantResponse...');
//   const randomLength = lengths[Math.floor(Math.random() * lengths.length)];
//   // const randomType = types[Math.floor(Math.random() * types.length)];
//   // const randomTopic = topics[Math.floor(Math.random() * topics.length)];
//   const prompt = `the next tweet should be ${randomLength}.  remember always include $mfer. next`;
//   console.log(`Sending prompt: ${prompt}`);
//   await tweetAssistantResponse(prompt);
// });