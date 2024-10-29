require('dotenv').config(); // Load environment variables
const { OpenAI } = require('openai'); // Import OpenAI SDK
const { sendTweet } = require('./twitter.js'); // Import the sendTweet function
const { generateImage } = require('./image.js'); // Import image generation function
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

function generateMferImageURL() {
  const randomNumber = Math.floor(Math.random() * 10021); // Random number between 0 and 10020
  return `https://plain.mfers.dev/${randomNumber}.png`;
}

// Main function to create a thread, add a message, run the assistant, and tweet the response
async function tweetAssistantResponse(prompt, imagePrompt) {
  console.log('Starting tweetAssistantResponse...');

  try {
    // const threadId = await createNewThread('Tweet Assistant Thread');
    const threadId = "thread_FPHRJSjuJjRWm2pAKOVExB7a"
    // const threadId = "thread_4VhjP76xjye37eeziZ0Uu0XJ"
    await createMessage(threadId, prompt);
    const assistantResponse = await runThread(threadId);
    
    if (assistantResponse) {
      // const imageUrl = await generateImage(imagePrompt);
      // const imageUrl = "https://pbs.twimg.com/profile_images/1630381377119039489/324MZNjk_400x400.jpg"
      const imageUrl = generateMferImageURL();

      if (imageUrl) {
        console.log(`Image generated. URL: ${imageUrl}`);
        const localImagePath = path.join(__dirname, 'temp-image.png');
        await downloadImage(imageUrl, localImagePath);
        await sendTweet(assistantResponse, localImagePath);
        await deleteLocalImage(localImagePath);
      } else {
        await sendTweet(assistantResponse);
      }

      console.log('Tweet sent successfully!');
    } else {
      console.error('Failed to generate a valid assistant response.');
    }
  } catch (error) {
    console.error('Error during OpenAI and Twitter interaction:', error);
  }
}


const lengths = ["1-25 characters", "25-75 characters", "75-150 characters", "150-240 characters"];
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


cron.schedule('0,30 * * * *', async () => {
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