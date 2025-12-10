// assistant.js

const { openai, neynarClient } = require('./client');
const {
  loadUserProfiles,
  saveUserProfiles,
  getOpenAIThreadId,
  saveOpenAIThreadId,
} = require('./threadUtils');
const { getMferDescription } = require('./mfer.js');
const imageModule = require('./image.js');
const { interpretUrl } = require('./attachments.js');
const { createToken } = require('./zora.js')
const farcaster = require('./farcaster');
const mintclub = require('./mintClub');
const degen = require('./degen');
const personalPrompt = require('./personalPrompt');
const ham = require('./ham');
const axios = require('axios');
const FormData = require('form-data');
const { handleRequiresAction, imageUrlMap } = require('./actionHandler');

// In-memory cache to track message hashes the bot has replied to
const repliedMessageHashes = new Set();

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
  const maxRetries = 10; // Maximum number of retries
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      // Check the current runs for the thread before creating a message
      const runs = await openai.beta.threads.runs.list(threadId);

      // Check if there's any ongoing run
      const inProgressRun = runs.data.find(run => run.status === 'in_progress');

      // If an in-progress run exists, wait for it to complete
      if (inProgressRun) {
        console.log(`[CREATE MESSAGE] Run already in progress for thread ${threadId}, waiting for it to complete before creating a message...`);
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait for 10 seconds
        continue; // Retry creating the message after waiting
      }

      // Handle required actions if a run is stuck requiring action
      const requiresActionRun = runs.data.find(run => run.status === 'requires_action');
      if (requiresActionRun) {
        console.log('[CREATE MESSAGE] Handling required action for run:', requiresActionRun.id);
        await handleRequiresAction(requiresActionRun, threadId);
        continue; // Retry creating the message after handling the required action
      }

      // Try to create the message in the thread
      await openai.beta.threads.messages.create(threadId, {
        role: 'user',
        content: userMessage,
      });
      console.log('Message created in thread:', threadId);
      return; // Exit the loop after successful creation
    } catch (error) {
      // Check if the error indicates a run in progress or other retryable conditions
      if (error.response && error.response.data && error.response.data.error) {
        const errorMessage = error.response.data.error.message;

        // Log the specific error message and retry logic
        console.error(`Error creating message: ${errorMessage}. Attempt ${attempt + 1} of ${maxRetries}. Retrying in 10 seconds...`);
        
        // Wait 10 seconds before retrying
        await new Promise(resolve => setTimeout(resolve, 10000));
        attempt++;
      } else {
        // For non-retryable errors, log and break the loop
        console.error('Unexpected error:', error.response ? error.response.data : error.message);
        break;
      }
    }
  }

  // Log final failure after all retries
  if (attempt === maxRetries) {
    console.error('Max retries reached. Could not create message.');
  }
}

// Utility function to run the Assistant on a thread with retry logic
async function runThread(threadId, assistantId) {
  const maxRetries = 10; // Set a maximum number of retries
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      console.warn(`[RUN THREAD] Checking for ongoing runs on thread: ${threadId} (Attempt ${attempt + 1})`);

      // Fetch the list of runs for the given thread
      let runs = await openai.beta.threads.runs.list(threadId);

      // Check if there's any ongoing run
      let inProgressRun = runs.data.find(run => run.status === 'in_progress');
      
      if (inProgressRun) {
        console.log(`[RUN THREAD] Run already in progress for thread ${threadId}, waiting for it to complete...`);
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait for 10 seconds
        continue; // Skip to the next loop iteration
      }

      // Check if there's a run that requires action
      let requiresActionRun = runs.data.find(run => run.status === 'requires_action');

      // While loop to handle all required actions sequentially
      while (requiresActionRun) {
        console.log('[RUN THREAD] Run requires action:', threadId);
        requiresActionRun = await handleRequiresAction(requiresActionRun, threadId);

        // Re-fetch runs to see if there are still any actions required
        runs = await openai.beta.threads.runs.list(threadId);
        requiresActionRun = runs.data.find(run => run.status === 'requires_action');
      }

      // If no runs in progress or requiring action, start a new run
      let run = await openai.beta.threads.runs.createAndPoll(threadId, {
        assistant_id: assistantId,
        model: process.env.MODEL,
        // instructions: `use the following user profiles as context... \n${userContext}`, // Add instructions if needed
      });

      // Handle required actions if any
      while (run.status === 'requires_action') {
        console.log('Run requires action:', threadId);
        run = await handleRequiresAction(run, threadId);
      }

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

  console.error('Max retries reached. Failed to complete the assistant run.');
}

// Add this cache to track message counts per FID
const messageTracker = {};

// Helper function to clean up expired entries with logging
function cleanupMessageTracker(fid) {
  const now = Date.now();
  const initialCount = messageTracker[fid]?.length || 0;

  // Filter out timestamps that are older than 60 seconds
  messageTracker[fid] = messageTracker[fid].filter(timestamp => now - timestamp <= 60000);

  const removedCount = initialCount - messageTracker[fid].length;
  if (removedCount > 0) {
    console.log(`Cleanup for FID ${fid}: removed ${removedCount} old messages.`);
  }

  // If no recent messages are left, delete the FID entry
  if (messageTracker[fid].length === 0) {
    delete messageTracker[fid];
    console.log(`Removed FID ${fid} from message tracker due to no recent messages.`);
  }
}

// Modified handleWebhook function with spam detection and additional logging
async function handleWebhook(req, res) {
  try {
    console.log('Received webhook data:', JSON.stringify(req.body, null, 2));
    const hookData = req.body;
    const farcasterThreadId = hookData.data.thread_hash;
    const messageHash = hookData.data.hash;
    const castText = hookData.data.text;
    const authorUsername = hookData.data.author.username;
    const authorFID = hookData.data.author.fid;
    const now = Date.now();

    // Initialize message tracking for the authorFID if not present
    if (!messageTracker[authorFID]) {
      messageTracker[authorFID] = [];
      console.log(`Initialized message tracker for FID ${authorFID}`);
    }

    // Add current timestamp to track recent messages
    messageTracker[authorFID].push(now);
    console.log(`Added message timestamp for FID ${authorFID}: ${now}`);
    console.log(`Current timestamps for FID ${authorFID}:`, messageTracker[authorFID]);

    // Cleanup old timestamps and log the process
    cleanupMessageTracker(authorFID);
    console.log(`After cleanup, timestamps for FID ${authorFID}:`, messageTracker[authorFID]);

    // Check for spam based on recent message count within time windows
    const recentMessages = messageTracker[authorFID];
    const messagesInLast10Sec = recentMessages.filter(ts => now - ts <= 10000).length;
    const messagesInLast60Sec = recentMessages.filter(ts => now - ts <= 60000).length;

    console.log(`FID ${authorFID} sent ${messagesInLast10Sec} messages in the last 10 seconds and ${messagesInLast60Sec} messages in the last 60 seconds.`);

    if (messagesInLast10Sec > 3) {
      // More than 3 messages in last 10 seconds
      const spamMessage = 'u mfer \n\n spam detected - message ignored';
      console.log(`Spam detected for FID ${authorFID}: ${spamMessage}`);
      await neynarClient.publishCast(process.env.SIGNER_UUID, spamMessage, { replyTo: messageHash });
      res.status(200).send('Spam message detected and response sent.');
      return;
    }

    if (messagesInLast60Sec > 5) {
      // More than 5 messages in last 60 seconds
      const spamMessage = 'u mfer \n\n spam detected - message ignored';
      console.log(`Spam detected for FID ${authorFID}: ${spamMessage}`);
      await neynarClient.publishCast(process.env.SIGNER_UUID, spamMessage, { replyTo: messageHash });
      res.status(200).send('Spam message detected and response sent.');
      return;
    }

    // Proceed with normal handling if not spam
    if (repliedMessageHashes.has(messageHash)) {
      console.log(`Already replied to message hash: ${messageHash}. Skipping reply.`);
      res.status(200).send('Already replied to this message.');
      return;
    }

    console.log(`Liking the post with hash: ${messageHash}`);
    await neynarClient.publishReactionToCast(process.env.SIGNER_UUID, "like", messageHash);

    res.status(200).send('Webhook received, post liked!');

    // Add the message hash to the cache to avoid duplicate replies
    repliedMessageHashes.add(messageHash);

    // Check if the cast contains #personalprompt
    if (castText.includes('#personalprompt')) {
      // Handle personal prompt
      const prompt = castText.replace('#personalprompt', '').replace('@mfergpt', '').trim();
      personalPrompt.setPersonalPrompt(authorFID, prompt);

      console.log(`Saved personal prompt for FID ${authorFID}`);
    }

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

    // Get the verified Ethereum address of the user who sent the message
    const verifiedEthereumAddress = hookData.data.author.verified_addresses.eth_addresses[0] || null;

    // Retrieve the personal prompt for the authorFID, if available
    const personalPromptText = personalPrompt.getPersonalPrompt(authorFID) || null;

    // Create a more machine-friendly user message using JSON to send data
    let userMessageObject = {
      instructions: [
        "First, look up this thread to get context. Always do this in case there have been more messages since you last interacted.",
        "Remember, never describe the cast, just simply respond to it as if you were replying directly to that user.",
        `Now, respond to the latest cast from ${authorUsername}.`
      ],
      data: {
        messageHash: messageHash,
        authorUsername: authorUsername,
        verifiedEthereumAddress: verifiedEthereumAddress,
        castText: castText
      }
    };

    // Include personalPrompt in the data if it's available
    if (personalPromptText) {
      userMessageObject.data.personalPrompt = personalPromptText;
    }

    let userMessage = JSON.stringify(userMessageObject, null, 2);

    await createMessage(threadId, userMessage);

    // Step 3: Run the Assistant on the thread
    let botMessage = 'Sorry, I couldn\'t complete the request at this time.';
    const run = await runThread(threadId, process.env.ASST_MODEL);

    if (!run || !run.status) {
      console.error('Run object is undefined or missing a status property.');
      const errorMessage = 'sorry mfer my circuits got scrambled\n\npls try again in a minute\n\n🤖-\'';
      await neynarClient.publishCast(process.env.SIGNER_UUID, errorMessage, { replyTo: messageHash });
      res.status(200).send('OpenAI run failed');
      return;
    }

    // Check if the run has completed successfully
    if (run.status === 'completed') {
      const messages = await openai.beta.threads.messages.list(run.thread_id);

      if (messages && messages.data && messages.data.length > 0) {
        const assistantMessages = messages.data.filter(msg => msg.role === 'assistant');
        if (assistantMessages.length > 0) {
          botMessage = assistantMessages[0].content[0].text.value;
          console.log(`Generated response using threadID ${threadId}`);
        } else {
          console.error('No assistant messages found.');
        }
      } else {
        console.error('No messages found in the thread.');
      }
    } else {
      console.error(`Run did not complete successfully. Status: ${run.status}`);
    }

    // Step 7: Reply to the cast with the Assistant's response and attach the image if generated
    const replyOptions = {
      replyTo: messageHash,
    };

    const imageUrl = imageUrlMap[run.id];
    if (imageUrl) {
      replyOptions.embeds = [{ url: imageUrl }];
      console.log(`Image generated and attached: ${imageUrl}`);
    }

    botMessage = replaceMultipliersAndCountHam(5, botMessage);
    botMessage = addHamTip(botMessage);

    // Check if the botMessage exceeds the 768 character limit
    const maxChunkSize = 768;
    const messageChunks = splitMessageIntoChunks(botMessage, maxChunkSize);


    // Flag to check if the image URL needs to be included
    let previousReplyHash = messageHash;
    let isFirstChunk = true;

    for (const chunk of messageChunks) {
      // Include the image URL only in the first reply if it exists
      const currentReplyOptions = {
        replyTo: previousReplyHash,
        ...(isFirstChunk && imageUrl ? { embeds: [{ url: imageUrl }] } : {})
      };

      const reply = await neynarClient.publishCast(
        process.env.SIGNER_UUID,
        chunk,
        currentReplyOptions
      );

      console.log('Reply sent:', chunk);
      
      // Update previousReplyHash to thread subsequent messages correctly
      previousReplyHash = reply.hash;
      
      // Set the flag to false after the first chunk
      isFirstChunk = false;

      delete imageUrlMap[run.id];
    }

    console.log('Reply sent:', botMessage);
    // res.status(200).send('Webhook received and response sent!');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(200).send('Server error');
  }
}

// Helper function to split the message into chunks of a specified size
function splitMessageIntoChunks(message, maxChunkSize) {
  const chunks = [];
  for (let i = 0; i < message.length; i += maxChunkSize) {
    chunks.push(message.slice(i, i + maxChunkSize));
  }
  return chunks;
}

function replaceMultipliersAndCountHam(maxHam, text) {
  // Replace x25 or x 25 where 25 is the maxHam, and wrap it in [brackets]
  text = text.replace(/\bx\s*(\d+)/g, (match, p1) => {
    return parseInt(p1) > maxHam ? `[x${p1}]` : match;
  });

  // Count the total instances of 🍖
  let hamCount = 0;

  // Replace extra 🍖 emojis with [HAM]
  text = text.replace(/🍖/g, () => {
    hamCount++;
    return hamCount > maxHam ? '[HAM]' : '🍖';
  });

  // Replace patterns like "69 $DEGEN" with "69 [DEGEN]"
  text = text.replace(/(\d+)\s?\$([A-Za-z]+)/g, (match, num, ticker) => {
    console.log(`Adjusting pattern "${match}" to "${num} [${ticker}]".`);
    return `${num} [${ticker}]`;
  });

  return text;
}

function addHamTip(inputString, multiplier = 15) {
    // Regular expression to find the rating in the format RATE:number/5 without brackets for the match,
    // but still replace the entire thing if surrounded by brackets
    const ratingRegex = /\[.*RATE:(\d)\/5.*\]/;

    // Search for the rating in the input string
    const match = inputString.match(ratingRegex);

    if (match) {
        // Extract the rating number
        const rating = parseInt(match[1], 10);

        // Calculate the tip amount
        const tipAmount = rating * multiplier;

        // Replace the whole part surrounded by brackets with the ham tip
        const outputString = inputString.replace(ratingRegex, `\n\n🍖 x${tipAmount}`);

        return outputString;
    } else {
        // If no rating is found, return the original string
        return inputString;
    }
}

// Function to get XMTP conversation analytics (can be called by AI)
async function getXMTPConversationInfo(conversationId, client) {
  try {
    console.log(`Getting XMTP conversation info for: ${conversationId}`);
    
    const conversation = await client.conversations.getConversationById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const { getConversationAnalytics } = require('./xmtpUtils');
    const analytics = await getConversationAnalytics(conversation, client);
    
    if (analytics) {
      // Return formatted info for the AI
      return {
        success: true,
        conversation: {
          id: analytics.info.conversationId,
          type: analytics.info.conversationType,
          created: analytics.info.createdAt,
          messageCount: analytics.info.messageCount,
          participants: analytics.participants,
          lastActivity: analytics.status.lastActivity,
          conversationAge: analytics.status.conversationAge,
          messageStats: analytics.messageHistory?.stats
        }
      };
    }
    
    throw new Error('Could not retrieve conversation analytics');
  } catch (error) {
    console.error('Error getting XMTP conversation info:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Function specifically for processing XMTP messages
async function processXMTPMessage(messageContent, senderInfo, conversationId = null, client = null) {
  try {
    console.log(`Processing XMTP message: "${messageContent}" from ${senderInfo.username || senderInfo.fid}`);

    // Create/lookup the thread for this XMTP conversation. If conversationId is
    // available we use that so every participant in the same chat maps to the
    // same OpenAI thread. For 1-on-1 chats (or any case where conversationId is
    // null) we fall back to the sender's fid which is effectively their wallet
    // address.
    const xmtpThreadId = `xmtp_${conversationId || senderInfo.fid}`;
    let threadId = getOpenAIThreadId(xmtpThreadId);

    if (!threadId) {
      // No existing OpenAI thread, create a new one
      threadId = await createNewThread(`XMTP Chat with ${senderInfo.username || senderInfo.fid}`);
      
      // Save the new mapping
      saveOpenAIThreadId(xmtpThreadId, threadId);
      console.log(`Created new thread ${threadId} for XMTP conversation ${xmtpThreadId}`);
    } else {
      console.log(`Using existing OpenAI thread ID: ${threadId} for XMTP conversation: ${xmtpThreadId}`);
    }

    // Retrieve the personal prompt for the sender, if available
    const personalPromptText = personalPrompt.getPersonalPrompt(senderInfo.fid) || null;

    // Build a concise user message for the assistant
    const cleanUsername = senderInfo.username.startsWith('@')
      ? senderInfo.username
      : `@${senderInfo.username}`;

    let userMessage = `${cleanUsername} says: ${messageContent}`;

    // Attach metadata lines for the assistant to reference
    if (conversationId) {
      userMessage += `\n\n[conversationId: ${conversationId}]`;
    }

    // Append personal prompt unobtrusively if it exists
    if (personalPromptText) {
      userMessage += `\n\n(Personal prompt: ${personalPromptText})`;
    }

    // Debug: Log the final text being sent to OpenAI
    console.log(`🤖 Sending to AI: ${userMessage}`);

    await createMessage(threadId, userMessage);

    // Run the Assistant on the thread (use XMTP_MODEL if available, otherwise fall back to ASST_MODEL)
    let botMessage = 'Sorry, I couldn\'t complete the request at this time.';
    const assistantModel = process.env.XMTP_MODEL || process.env.ASST_MODEL;
    const run = await runThread(threadId, assistantModel);
    
    console.log(`Using assistant model: ${assistantModel} for XMTP message`);

    if (!run || !run.status) {
      console.error('Run object is undefined or missing a status property.');
      throw new Error('OpenAI run failed');
    }

    // Check if the run has completed successfully
    if (run.status === 'completed') {
      const messages = await openai.beta.threads.messages.list(run.thread_id);

      if (messages && messages.data && messages.data.length > 0) {
        const assistantMessages = messages.data.filter(msg => msg.role === 'assistant');
        if (assistantMessages.length > 0) {
          botMessage = assistantMessages[0].content[0].text.value;
          console.log(`Generated XMTP response using threadID ${threadId}`);
        } else {
          console.error('No assistant messages found.');
          throw new Error('No assistant response generated');
        }
      } else {
        console.error('No messages found in the thread.');
        throw new Error('No messages in thread');
      }
    } else if (run.status === 'requires_action') {
      // Handle function calls if needed
      const updatedRun = await handleRequiresAction(run, threadId);
      
      if (updatedRun && updatedRun.status === 'completed') {
        const messages = await openai.beta.threads.messages.list(updatedRun.thread_id);
        
        if (messages && messages.data && messages.data.length > 0) {
          const assistantMessages = messages.data.filter(msg => msg.role === 'assistant');
          if (assistantMessages.length > 0) {
            botMessage = assistantMessages[0].content[0].text.value;
            console.log(`Generated XMTP response with actions using threadID ${threadId}`);
          }
        }
      }
    } else {
      console.error(`Run did not complete successfully. Status: ${run.status}`);
      throw new Error(`OpenAI run failed with status: ${run.status}`);
    }

    return botMessage;

  } catch (error) {
    console.error('Error processing XMTP message:', error);
    return 'Sorry, I encountered an error processing your message. Please try again.';
  }
}

// Update exports to include the functions needed by niftyHandler
module.exports = {
  handleRequiresAction,
  createNewThread,
  createMessage,
  runThread,
  generateImage: imageModule.generateImage,
  handleWebhook,
  splitMessageIntoChunks,
  processXMTPMessage,
  getXMTPConversationInfo,
};
