const express = require('express');
const { NeynarAPIClient } = require('@neynar/nodejs-sdk');
const OpenAI = require('openai');
const { getOpenAIThreadId, saveOpenAIThreadId } = require('../threadUtils');
const TinyURL = require('tinyurl');
const axios = require('axios'); 
require('dotenv').config();

// Initialize Neynar client
const neynarClient = new NeynarAPIClient(process.env.NEYNAR_API_KEY);

// In-memory cache to track message hashes the bot has replied to
const repliedMessageHashes = new Set();

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, organization: process.env.OPENAI_ORG });

const app = express();
const PORT = 3000;

// Utility function to create a new thread
async function createNewThread(name, channelId) {
  try {
    const assistantId = process.env.ASST_MODEL; // Use the assistant ID from environment variables

    // Create a new thread using the OpenAI SDK
    const thread = await openai.beta.threads.create({
      // assistant_id: assistantId,
      // name: name, // Optional: name of the thread
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

// Utility function to create a message in a thread
async function createMessage(threadId, userMessage) {
  try {
    await openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content: userMessage,
    });
    console.log('Message created in thread:', threadId);
  } catch (error) {
    console.error('Error creating message:', error.response ? error.response.data : error.message);
    throw new Error('An error occurred while creating a message in the thread.');
  }
}

// Utility function to run the Assistant on a thread
async function runThread(threadId) {
  try {
    console.warn(`Running assistant on thread: ${threadId}`);
    const run = await openai.beta.threads.runs.createAndPoll(threadId, {
      assistant_id: process.env.ASST_MODEL,
      model: process.env.MODEL,
      // instructions: "",
    });

    console.log('Run completed on thread:', threadId);
    return run;
  } catch (error) {
    console.error('Error running thread:', error.response ? error.response.data : error.message);
    throw new Error('An error occurred while running the assistant on the thread.');
  }
}

// Endpoint to receive the webhook
// app.post('/webhook', async (req, res) => {
module.exports = async (req, res) => {
  try {
    // Print all details of the webhook to understand its structure
    console.log('Received webhook data:', JSON.stringify(req.body, null, 2));

    const hookData = req.body;
    const farcasterThreadId = hookData.data.thread_hash; // Use thread_hash for managing threads
    const messageHash = hookData.data.hash; // Use hash for replying
    const castText = hookData.data.text;

    // Check if the bot has already replied to this message
    if (repliedMessageHashes.has(messageHash)) {
      console.log(`Already replied to message hash: ${messageHash}. Skipping reply.`);
      res.status(200).send('Already replied to this message.');
      return;
    }

    // Add the message hash to the cache to avoid duplicate replies
    repliedMessageHashes.add(messageHash);

    // Check if there's already an OpenAI thread associated with this Farcaster thread
    let threadId = getOpenAIThreadId(farcasterThreadId);

    if (!threadId) {
      // No existing OpenAI thread, create a new one
      threadId = await createNewThread(`Response for ${hookData.data.author.username}`);

      // Save the new mapping
      saveOpenAIThreadId(farcasterThreadId, threadId);
    } else {
      console.log(`Using existing OpenAI thread ID: ${threadId} for Farcaster thread ID: ${farcasterThreadId}`);
    }

    // Step 2: Add the initial user message to the thread
    await createMessage(threadId, castText);

    // Step 3: Run the Assistant on the thread
    const shouldRun = true; // Replace with your logic if needed
    let botMessage = 'Sorry, I couldn’t complete the request at this time.';
    let imageUrl = null;

    // Check if the message includes #generateimage
    if (castText.includes('#generateimage')) {
      imageUrl = await generateImage(threadId, castText);
      botMessage = "heres ur image mfer"
    } else {
      if (shouldRun) {
      const run = await runThread(threadId);

      // Check if the run has completed successfully
      if (run.status === 'completed') {
        const messages = await openai.beta.threads.messages.list(run.thread_id);

        if (messages && messages.data && messages.data.length > 0) {
          const assistantMessages = messages.data.filter(msg => msg.role === 'assistant');

          if (assistantMessages.length === 0) {
            console.error('No assistant messages found.');
            res.status(200).send('No assistant response generated.');
            return;
          }

          const latestAssistantMessage = assistantMessages[0]; // Get the latest message
          if (latestAssistantMessage && latestAssistantMessage.content && latestAssistantMessage.content[0] && latestAssistantMessage.content[0].text) {
            botMessage = latestAssistantMessage.content[0].text.value;
            console.log(`Generated response using threadID ${threadId}`);
          } else {
            console.error('Assistant message content is not structured as expected.');
          }
        } else {
          console.error('No messages found in the thread.');
        }
      } else {
        console.error(`Run did not complete successfully. Status: ${run.status}`);
      }
    }
    }

    // Step 7: Reply to the cast with the Assistant's response and attach the image if generated
    const replyOptions = {
      replyTo: messageHash, // Use the specific message hash for correct threading
    };

    if (imageUrl) {
      replyOptions.embeds = [{ url: imageUrl }];
      console.log(`Image generated and attached: ${imageUrl}`);
    }

    const reply = await neynarClient.publishCast(
      process.env.SIGNER_UUID,
      botMessage,
      replyOptions
    );

    console.log('Reply sent:', reply);
    res.status(200).send('Webhook received and response sent!');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send('Server error');
  }
};

async function generateImage(threadId, castText) {
  try {
    console.log('Image generation requested.');

    // Step 1: Check for all #mfer[id] patterns and fetch the descriptions
    const mferPattern = /#mfer(\d+)/g; // Use global flag to match all occurrences
    const matches = [...castText.matchAll(mferPattern)]; // Get all matches

    if (matches.length > 0) {
      console.log(`Found mfer IDs: ${matches.map(match => match[1])}`);

      // Fetch descriptions for all matched mfer IDs
      const fetchDescriptions = matches.map(async match => {
        const mferId = match[1]; // Extract the mfer ID from each match
        try {
          const response = await axios.get(`https://gpt.mfers.dev/descriptions/${mferId}.json`);
          return { id: mferId, description: response.data.description };
        } catch (fetchError) {
          console.error(`Error fetching mfer description for ID ${mferId}: ${fetchError.message}`);
          return { id: mferId, description: `mfer ${mferId}` }; // Fallback to generic description if fetch fails
        }
      });

      // Resolve all promises and replace the hashtags with their descriptions
      const descriptions = await Promise.all(fetchDescriptions);
      descriptions.forEach(({ id, description }) => {
        castText = castText.replace(new RegExp(`#mfer${id}`, 'g'), description);
      });

      console.log(`Modified cast text with descriptions: ${castText}`);
    }

    // Step 2: Ask Assistant to create an image prompt based on the user's message
    const imagePrompt = `Create image: "${castText.replace('#generateimage', '').trim()}"`;

    // Step 3: Generate the image using the prompt
    const imageResponse = await openai.images.generate({
      prompt: imagePrompt,
      n: 1,
      size: "1024x1024",
      model: "dall-e-3",
      style: "vivid",
      quality: "hd"
    });

    let longUrl = imageResponse.data[0].url;

    // Step 4: Shorten the image URL
    const imageUrl = await TinyURL.shorten(longUrl);
    console.log(`Image generated and shortened URL: ${imageUrl}`);

    return imageUrl;
  } catch (error) {
    console.error('Error generating image:', error);
    return null;
  }
}

app.listen(PORT, () => {
  console.log(`Server is listening on http://localhost:${PORT}`);
});