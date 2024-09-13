const express = require('express');
const bodyParser = require('body-parser');
const { NeynarAPIClient } = require('@neynar/nodejs-sdk');
const OpenAI = require('openai');
const { getOpenAIThreadId, saveOpenAIThreadId } = require('./threadUtils');
const TinyURL = require('tinyurl');
const axios = require('axios'); 
const fetch = require('node-fetch'); // Import node-fetch for making API requests
const FormData = require('form-data');

require('dotenv').config();

// Initialize Neynar client
const neynarClient = new NeynarAPIClient(process.env.NEYNAR_API_KEY);

// In-memory cache to track message hashes the bot has replied to
const repliedMessageHashes = new Set();

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, organization: process.env.OPENAI_ORG });

const app = express();
const PORT = 3000;

app.use(bodyParser.json());

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

// Utility function to run the Assistant on a thread with retry logic
async function runThread(threadId) {
  const maxRetries = 3; // Set a maximum number of retries
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      console.warn(`Running assistant on thread: ${threadId} (Attempt ${attempt + 1})`);
      const run = await openai.beta.threads.runs.createAndPoll(threadId, {
        assistant_id: process.env.ASST_MODEL,
        model: process.env.MODEL,
        // instructions: "",
      });

      if (run.status === 'completed') {
        console.log('Run completed successfully on thread:', threadId);
        return run;
      } else {
        console.error(`Run did not complete successfully. Status: ${run.status}`);
      }
    } catch (error) {
      console.error('Error running thread:', error.response ? error.response.data : error.message);
    }

    attempt++;
    if (attempt < maxRetries) {
      console.log('Waiting 5 seconds before retrying...');
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds
    }
  }

  throw new Error('Max retries reached. Failed to complete the assistant run.');
}

// Utility function to fetch all messages in a Farcaster thread
async function fetchFarcasterThreadMessages(castHash) {
  const url = `https://api.neynar.com/v2/farcaster/cast/conversation?identifier=${castHash}&type=hash&reply_depth=2&include_chronological_parent_casts=false&limit=20`;
  const options = {
    method: 'GET',
    headers: {
      accept: 'application/json',
      api_key: process.env.NEYNAR_API_KEY, // Use the API key from environment variables
    },
  };

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`Failed to fetch thread messages: ${response.statusText}`);
    }

    const data = await response.json();

    // Extract the main cast and direct replies
    const mainCast = data.conversation.cast;
    const directReplies = mainCast.direct_replies || [];

    // Combine the main cast and all direct replies into a single array
    const allMessages = [mainCast, ...directReplies];

    // Recursively gather messages from nested direct replies
    const gatherMessages = (replies) => {
      return replies.flatMap(reply => {
        const nestedReplies = reply.direct_replies || [];
        return [reply, ...gatherMessages(nestedReplies)];
      });
    };

    // Get all nested messages
    const nestedMessages = gatherMessages(directReplies);

    // Combine main cast messages and nested messages
    const combinedMessages = [mainCast, ...nestedMessages];

    // Combine messages into a single context string
    const context = combinedMessages.map(msg => `${msg.author.display_name}: ${msg.text}`).join('\n');
    console.log(`Fetched ${combinedMessages.length} messages from Farcaster thread with hash: ${castHash}`);
    
    return context;
  } catch (error) {
    console.error('Error fetching thread messages:', error.message);
    return '';
  }
}

// Endpoint to receive the webhook
app.post('/webhook', async (req, res) => {
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

    const conversationContext = await fetchFarcasterThreadMessages(farcasterThreadId);


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
    // await createMessage(threadId, castText);
    await createMessage(threadId, `Farcaster thread history: ${conversationContext}\n\n------\n\nLatest cast from ${hookData.data.author.username}: ${castText}`);

    // Step 3: Run the Assistant on the thread
    const shouldRun = true; // Replace with your logic if needed
    let botMessage = 'Sorry, I couldn’t complete the request at this time.';
    let imageUrl = null;

    // Check if the message includes #generateimage
    if (castText.includes('#generateimage')) {
      imageUrl = await generateImage(threadId, castText);
      if (imageUrl) {
        botMessage = "heres ur image mfer"
      } else {
        botMessage = 'no luck, try again'
      }
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
});

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

    // Step 2: Create an image prompt based on the user's message
    const imagePrompt = `${castText.replace('#generateimage', '').trim()}`;

    // Step 3: Generate the image using the prompt
    const imageResponse = await openai.images.generate({
      prompt: imagePrompt,
      n: 1,
      size: "1024x1024",
      model: "dall-e-3",
      response_format: "b64_json", // Get the image data in base64 format
    });

    const imageBase64 = imageResponse.data[0].b64_json;

    // Step 4: Upload the image to FreeImage.host
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('key', process.env.FREEIMAGE_API_KEY); // Your API key for FreeImage.host
    formData.append('action', 'upload');
    formData.append('source', imageBase64);
    formData.append('format', 'json');

    const uploadResponse = await axios.post('https://freeimage.host/api/1/upload', formData, {
      headers: formData.getHeaders(),
    });

    // Extract the image URL from the response
    // const imageUrl = uploadResponse.data.image.url.full;
    const imageUrl = uploadResponse.data.image.url; // Full-size image
    console.log(`Image generated and uploaded. URL: ${imageUrl}`);

    return imageUrl;
  } catch (error) {
    console.error('Error generating image:', error);
    return null;
  }
}
  

app.listen(PORT, () => {
  console.log(`Server is listening on http://localhost:${PORT}`);
});