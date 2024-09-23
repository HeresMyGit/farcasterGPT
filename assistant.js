// assistant.js

const { openai, neynarClient } = require('./client');
const {
  loadUserProfiles,
  saveUserProfiles,
  getOpenAIThreadId,
  saveOpenAIThreadId,
} = require('./threadUtils');
const { getMferDescription } = require('./mfer.js');
const { generateImage } = require('./image.js');
const { interpretUrl } = require('./attachments.js');
const farcaster = require('./farcaster');
const ham = require('./ham');
const axios = require('axios');
const FormData = require('form-data');

// In-memory cache to track message hashes the bot has replied to
const repliedMessageHashes = new Set();

// key = runId, value = image URL
const imageUrlMap = {};

// Assistant-related functions

// Function to handle required actions from the run
async function handleRequiresAction(run, threadId) {
  // Check if there are tools that require outputs

  if (
    run.required_action &&
    run.required_action.submit_tool_outputs &&
    run.required_action.submit_tool_outputs.tool_calls
  ) {
    // Prepare outputs for each required tool call
    const toolOutputs = await Promise.all(
      run.required_action.submit_tool_outputs.tool_calls.map(async (tool) => {
        if (tool.function.name === "fetch_user_profile") {
          // Extract the username parameter and fetch the user profile
          const { username, shouldFetchLatestCasts = false, shouldFetchPopularCasts = false } = JSON.parse(tool.function.arguments);
          const relevantUserProfiles = farcaster.loadAndFilterRelevantUserProfiles([username]);

          // Check if we have the relevant profile loaded; if not, generate on the fly
          console.warn(`Generating profile on the fly for ${username}...`);
          let userProfile = await farcaster.buildProfileOnTheFly(username, shouldFetchLatestCasts, shouldFetchPopularCasts);
          console.log(`Generated profile on the fly for ${username}.`);
          return {
            tool_call_id: tool.id,
            output: JSON.stringify(userProfile), // Format the fetched profile data
          };
        } else if (tool.function.name === "fetch_channel_details") {
          // Extract the query and shouldFetchTrendingCasts parameters
          const { query, shouldFetchTrendingCasts = false } = JSON.parse(tool.function.arguments);

          // Generate channel details on the fly with the shouldFetchTrendingCasts parameter
          console.warn(`Generating channel details on the fly for query: ${query}, shouldFetchTrendingCasts: ${shouldFetchTrendingCasts}...`);
          const channelDetails = await farcaster.buildChannelDetailsOnTheFly(query, shouldFetchTrendingCasts);
          console.log(`Generated channel details on the fly for query: ${query}.`);

          return {
            tool_call_id: tool.id,
            output: JSON.stringify(channelDetails), // Format the fetched channel details
          };
        } else if (tool.function.name === "fetch_ham_details") {
          // Extract the FID parameter and fetch the HAM info
          const { FID } = JSON.parse(tool.function.arguments);

          // Generate HAM info on the fly
          console.warn(`Fetching HAM info on the fly for FID: ${FID}...`);
          const hamInfo = await ham.getUserHamInfo(FID);
          console.log(`Fetched HAM info on the fly for FID: ${FID}.`);

          return {
            tool_call_id: tool.id,
            output: JSON.stringify(hamInfo), // Format the fetched HAM info
          };
        } else if (tool.function.name === "fetch_ham_leaderboard") {
          // Extract the page parameter, defaulting to 1 if not provided
          const { page = 1 } = JSON.parse(tool.function.arguments);

          // Fetch Ham scores on the fly
          console.warn(`Fetching Ham scores for page: ${page}...`);
          const hamScores = await ham.getHamScores(page);
          console.log(`Fetched Ham scores for page: ${page}.`);

          return {
            tool_call_id: tool.id,
            output: JSON.stringify(hamScores), // Format the fetched Ham scores
          };
        } else if (tool.function.name === "fetch_thread_details") {
          // Extract the cast and type parameters
          const { cast, type } = JSON.parse(tool.function.arguments);

          // Fetch Farcaster thread on the fly
          console.warn(`Fetching Farcaster thread messages for cast identifier: ${cast} with type: ${type}...`);
          const threadData = await farcaster.fetchFarcasterThread(cast, type);
          console.log(`Fetched Farcaster thread messages for cast identifier: ${cast} with type: ${type}.`);

          return {
            tool_call_id: tool.id,
            output: JSON.stringify(threadData), // Format the fetched thread data
          };
        } else if (tool.function.name === "fetch_floaty_leaderboard") {
          // Extract the tokenAddress and page parameters
          const { tokenAddress, page } = JSON.parse(tool.function.arguments);

          // Handle default value for page if it's not provided
          const pageNumber = page || 1;

          // Fetch Floaty leaderboard for the given tokenAddress
          console.warn(`Fetching Floaty leaderboard for token address: ${tokenAddress}, page: ${pageNumber}`);
          const leaderboard = await ham.getFloatyLeaderboard(tokenAddress, pageNumber);
          console.warn(`Fetched Floaty leaderboard for token address: ${tokenAddress}, page: ${pageNumber}`);

          return {
            tool_call_id: tool.id,
            output: JSON.stringify(leaderboard) // Return the leaderboard
          };
        } else if (tool.function.name === "fetch_floaties_leaderboard") {
          // Fetch Floaties leaderboard for all supported coins
          console.warn(`Fetching Floaties leaderboard for all coins...`);
          const leaderboard = await ham.getFloatiesLeaderboard();
          console.warn(`Fetched Floaties leaderboard for all coins...`);

          return {
            tool_call_id: tool.id,
            output: JSON.stringify(leaderboard) // Return the leaderboard
          };
        } else if (tool.function.name === "fetch_floaty_receivers_leaderboard") {
          // Extract the tokenAddress and page parameters
          const { tokenAddress, page } = JSON.parse(tool.function.arguments);

          // Handle default value for page if it's not provided
          const pageNumber = page || 1;

          // Fetch Floaty receivers leaderboard for the given tokenAddress
          console.warn(`Fetching Floaty receivers leaderboard for token address: ${tokenAddress}, page: ${pageNumber}`);
          const leaderboard = await ham.getFloatyReceiversLeaderboard(tokenAddress, pageNumber);
          console.warn(`Fetched Floaty receivers leaderboard for token address: ${tokenAddress}, page: ${pageNumber}`);

          return {
            tool_call_id: tool.id,
            output: JSON.stringify(leaderboard) // Return the receivers leaderboard
          };
        } else if (tool.function.name === "fetch_floaty_balances") {
          // Extract the address and fid parameters
          const { address, fid } = JSON.parse(tool.function.arguments);

          let balances;

          try {
            // Ensure that either address or fid is provided, but not both
            if (address && fid) {
              throw new Error("Provide either 'address' or 'fid', but not both.");
            } else if (address) {
              // Fetch balances by Ethereum address if provided
              console.warn(`Fetching Floaty balances for Ethereum address: ${address}`);
              balances = await ham.getFloatyBalancesByAddress(address);
              console.warn(`Fetched Floaty balances for Ethereum address: ${address}`);
            } else if (fid) {
              // Fetch balances by FID if provided
              console.warn(`Fetching Floaty balances for FID: ${fid}`);
              balances = await ham.getFloatyBalancesByFID(fid);
              console.warn(`Fetched Floaty balances for FID: ${fid}`);
            } else {
              // If neither is provided, throw an error
              throw new Error("Either 'address' or 'fid' must be provided.");
            }

            // Return the balances if fetched successfully
            return {
              tool_call_id: tool.id,
              output: JSON.stringify(balances) // Return the fetched balances
            };

          } catch (error) {
            console.error(`Error fetching Floaty balances: ${error.message}`);
            
            // Return an error message in case of failure
            return {
              tool_call_id: tool.id,
              output: JSON.stringify({ error: error.message })
            };
          }
        } else if (tool.function.name === "fetch_mfer_description") {
          // Extract the mferID parameter
          const { mferID } = JSON.parse(tool.function.arguments);

          // Validate the mferID
          if (mferID < 0 || mferID > 10020) {
            return {
              tool_call_id: tool.id,
              output: JSON.stringify({ error: "Invalid mfer ID provided. Must be between 0 and 10020." })
            };
          }

          // Fetch the mfer description and generate the image
          console.warn(`Fetching mfer description and generating image for ID: ${mferID}...`);
          const mferData = await getMferDescription(mferID);

          // Return the description and image
          return {
            tool_call_id: tool.id,
            output: JSON.stringify(mferData) // Return the mfer data, including traits and image
          };
        } else if (tool.function.name === "generate_image") {
          // Extract the prompt parameter
          const { prompt } = JSON.parse(tool.function.arguments);

          // Validate that the prompt is a non-empty string
          if (!prompt || typeof prompt !== "string") {
            return {
              tool_call_id: tool.id,
              output: JSON.stringify({ error: "Invalid prompt provided. Please provide a valid string." })
            };
          }

          // Call the image generation function (shell implementation for now)
          console.warn(`Generating image based on prompt: ${prompt}...`);
          const imageUrl = await generateImage(prompt); // Placeholder for actual image generation logic
          console.warn(`Generated image based on prompt: ${prompt}...`);

          // Store the image url in some map for later retrieval (use threadId/runId as key)
          imageUrlMap[run.id] = imageUrl;

          return {
            tool_call_id: tool.id,
            output: JSON.stringify(imageUrl) 
          };
        } else if (tool.function.name === "search_casts" || tool.function.name === "search_casts_by_author") {
            // Extract the parameters from the API call
            const { q, author_fid, viewer_fid, parent_url, channel_id, limit, cursor, api_key } = JSON.parse(tool.function.arguments);

            // Validate that the required parameter 'q' is provided
            if (!q || typeof q !== 'string') {
              return {
                tool_call_id: tool.id,
                output: JSON.stringify({ error: "Query parameter 'q' is required and must be a string." })
              };
            }

            // Fetch the casts using the fetchCasts function
            const castData = await farcaster.fetchCasts({
              q,
              author_fid,
              viewer_fid,
              parent_url,
              channel_id,
              limit,
              cursor,
              api_key
            });

            // Return the fetched data
            return {
              tool_call_id: tool.id,
              output: JSON.stringify(castData)
            };
          } else if (tool.function.name === "fetch_url_details") {
              const { url, prompt } = JSON.parse(tool.function.arguments);
              console.warn(`Fetching description for URL: ${url}, with prompt: ${prompt || 'none'}...`);
              
              // Assuming there's a function fetchUrlDescription that handles URL interpretation
              const description = await interpretUrl(url, prompt);
              console.log(`Fetched description for URL: ${url}.`);

              return {
                tool_call_id: tool.id,
                output: JSON.stringify({ description }), // Returning the description as JSON
              };
          }
        // Add other function handlers if necessary
      })
    );

    // Submit the tool outputs to the assistant
    if (toolOutputs.length > 0) {
      run = await openai.beta.threads.runs.submitToolOutputsAndPoll(
        threadId,
        run.id,
        { tool_outputs: toolOutputs.filter(Boolean) } // Filter out any undefined results
      );
      console.log("Tool outputs submitted successfully.");
    } else {
      console.log("No tool outputs to submit.");
    }

    // Check run status after submitting tool outputs
    return run;
  }

  // Return the run as is if no actions were required
  return run;
}

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
async function runThread(threadId, authorUsername) {
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
        assistant_id: process.env.ASST_MODEL,
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

// Moved the webhook handler code into a separate function
async function handleWebhook(req, res) {
  // Implementation of the webhook handling logic
  try {
    // Print all details of the webhook to understand its structure
    console.log('Received webhook data:', JSON.stringify(req.body, null, 2));

    const hookData = req.body;
    const farcasterThreadId = hookData.data.thread_hash; // Use thread_hash for managing threads
    const messageHash = hookData.data.hash; // Use hash for replying
    const castText = hookData.data.text;
    console.warn(`castText: ${castText}`)

    const authorUsername = hookData.data.author.username;

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
    // await createMessage(threadId, castText);
    await createMessage(threadId, `First, look up this thread to get context.  Always do this in case there have been more messages since you last interacted: Farcaster message hash: ${messageHash}\n\n------\n\nNow, respond to the latest cast from ${hookData.data.author.username}: ${castText}`);

    // Step 3: Run the Assistant on the thread
    let botMessage = 'Sorry, I couldn’t complete the request at this time.';

    const run = await runThread(threadId, authorUsername); // Step 2: Include userProfiles and authorUsername

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

    // Step 7: Reply to the cast with the Assistant's response and attach the image if generated
    const replyOptions = {
      replyTo: messageHash, // Use the specific message hash for correct threading
    };

    const imageUrl = imageUrlMap[run.id];
    if (imageUrl) {
      replyOptions.embeds = [{ url: imageUrl }];
      console.log(`Image generated and attached: ${imageUrl}`);
    }

    botMessage = replaceHam(10, botMessage)

    // Check if the botMessage exceeds the 768 character limit
    const maxChunkSize = 768;
    const messageChunks = splitMessageIntoChunks(botMessage, maxChunkSize);

    // Send each chunk sequentially
    let previousReplyHash = messageHash; // Start with the original message hash for threading

    // Flag to check if the image URL needs to be included
    let isFirstChunk = true;

    for (const chunk of messageChunks) {
      // Include the image URL only in the first reply if it exists
      const currentReplyOptions = {
        replyTo: previousReplyHash,
        ...(isFirstChunk && imageUrl ? { embeds: [{ url: imageUrl }] } : {}) // Include image URL only in the first chunk
      };

      // const reply = await neynarClient.publishCast(
      //   process.env.SIGNER_UUID,
      //   chunk,
      //   currentReplyOptions
      // );

      console.log('Reply sent:', chunk);
      
      // Update previousReplyHash to thread subsequent messages correctly
      previousReplyHash = reply.hash;
      
      // Set the flag to false after the first chunk
      isFirstChunk = false;

      delete imageUrlMap[run.id];
    }

    console.log('Reply sent:', botMessage);
    res.status(200).send('Webhook received and response sent!');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send('Server error');
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

function replaceHam(maxHam, text) {
  // Replace 🍖x100 or 🍖 x100 where 100 > maxHam
  text = text.replace(/🍖\s*x\s*(\d+)/g, (match, p1) => {
    return parseInt(p1) > maxHam ? `[HAM] x${p1}` : match;
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

module.exports = {
  handleRequiresAction,
  createNewThread,
  createMessage,
  runThread,
  generateImage,
  handleWebhook,
  splitMessageIntoChunks,
};
