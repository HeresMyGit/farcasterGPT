// assistant.js

const { openai, neynarClient } = require('./client');
const {
  loadUserProfiles,
  saveUserProfiles,
  getOpenAIThreadId,
  saveOpenAIThreadId,
} = require('./threadUtils');
const farcaster = require('./farcaster');
const axios = require('axios');
const FormData = require('form-data');

// In-memory cache to track message hashes the bot has replied to
const repliedMessageHashes = new Set();

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
          let userProfile;
          // if (relevantUserProfiles && Object.keys(relevantUserProfiles).length > 0) {
          //   userProfile = relevantUserProfiles[username];
          //   console.log(`Loaded profile for ${username} from cache.`);
          // } else {
          // Step 2: Generate the profile on the fly if not found
          console.warn(`Generating profile on the fly for ${username}...`);
          userProfile = await farcaster.buildProfileOnTheFly(username, shouldFetchLatestCasts, shouldFetchPopularCasts);
          console.log(`Generated profile on the fly for ${username}.`);
          // }
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
async function runThread(threadId, userProfiles, authorUsername) {
  const maxRetries = 10; // Set a maximum number of retries
  let attempt = 0;

  // Create a structured JSON object for all user profiles, ensuring the author's profile comes first
  let allUserProfilesJson = [];

  // Add the author's profile first, if it exists
  // if (userProfiles[authorUsername]) {
  //   const authorProfile = userProfiles[authorUsername];
  //   const { profile, popularCasts, recentCasts } = authorProfile;

  //   // Ensure that popularCasts and recentCasts are arrays before mapping
  //   const popularCastsList = Array.isArray(popularCasts)
  //     ? popularCasts.map(cast => ({ text: cast.text, timestamp: cast.timestamp, author: cast.author.username }))
  //     : [];
  //   const recentCastsList = Array.isArray(recentCasts)
  //     ? recentCasts.map(cast => ({ text: cast.text, timestamp: cast.timestamp, author: cast.author.username }))
  //     : [];

  //   // Add the author's profile to the list first
  //   allUserProfilesJson.push({
  //     profile: {
  //       username: profile.username,
  //       displayName: profile.display_name,
  //       bio: profile.profile.bio.text,
  //       followerCount: profile.follower_count,
  //       followingCount: profile.following_count,
  //     },
  //     popularCasts: popularCastsList,
  //     recentCasts: recentCastsList,
  //   });
  // } else {
  //   console.warn(`No user profile found for the author ${authorUsername}.`);
  // }

  // Add the other user profiles, skipping the author's profile since it's already added
  // for (const [username, userProfile] of Object.entries(userProfiles)) {
  //   if (username === authorUsername) continue; // Skip the author's profile as it's already added

  //   const { profile, popularCasts, recentCasts } = userProfile;

  //   // Ensure that popularCasts and recentCasts are arrays before mapping
  //   const popularCastsList = Array.isArray(popularCasts)
  //     ? popularCasts.map(cast => ({ text: cast.text, timestamp: cast.timestamp, author: cast.author.username }))
  //     : [];
  //   const recentCastsList = Array.isArray(recentCasts)
  //     ? recentCasts.map(cast => ({ text: cast.text, timestamp: cast.timestamp, author: cast.author.username }))
  //     : [];

  //   // Add each user profile to the list
  //   allUserProfilesJson.push({
  //     profile: {
  //       username: profile.username,
  //       displayName: profile.display_name,
  //       bio: profile.profile.bio.text,
  //       followerCount: profile.follower_count,
  //       followingCount: profile.following_count,
  //     },
  //     popularCasts: popularCastsList,
  //     recentCasts: recentCastsList,
  //   });
  // }

  // Convert all user profiles to a JSON string with indentation for readability
  // const userContext = JSON.stringify(allUserProfilesJson, null, 2);

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

async function generateImage(threadId, castText) {
  try {
    console.log('Image generation requested.');

    // Step 1: Check for all #mfer[id] patterns and fetch the descriptions
    const mferPattern = /#mfer(\d+)/g; // Use global flag to match all occurrences
    const matches = [...castText.matchAll(mferPattern)]; // Get all matches

    if (matches.length > 0) {
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

    const conversationContext = await farcaster.fetchFarcasterThreadMessages(farcasterThreadId);

    // Collect relevant usernames from messages (author, mentions, replies)
    const relevantUsernames = new Set();

    const threadMessages = await farcaster.fetchFarcasterThreadData(farcasterThreadId)

    // Iterate over messages to gather relevant usernames
    // for (const msg of threadMessages) {
    //   console.log(`Processing message from ${msg.author ? msg.author.username : 'unknown author'} with hash ${msg.hash}...`);
      
    //   // Add author username
    //   if (msg.author && msg.author.username) {
    //     relevantUsernames.add(msg.author.username);
    //     console.log(`Added author username: ${msg.author.username}`);
    //   }

    //   // Extract tagged usernames from the message text
    //   const taggedUsernames = farcaster.extractUsernames(msg.text, msg.mentioned_profiles);
    //   console.log(`Extracted tagged usernames: ${taggedUsernames.join(', ')}`);
    //   taggedUsernames.forEach((username) => {
    //     relevantUsernames.add(username);
    //     console.log(`Added tagged username: ${username}`);
    //   });

    //   // Get the user(s) that the message is replying to
    //   if (msg.parent_hash) {
    //     console.log(`Message has a parent hash: ${msg.parent_hash}`);
        
    //     // Fetch parent message by hash, ensuring the call is awaited
    //     try {
    //       const parentMsg = await farcaster.fetchMessageByHash(msg.parent_hash); // Corrected: added await to handle async function
    //       if (parentMsg && parentMsg.author && parentMsg.author.username) {
    //         relevantUsernames.add(parentMsg.author.username);
    //         console.log(`Added fetched parent message author username: ${parentMsg.author.username}`);
    //       } else {
    //         console.warn(`No author found for fetched parent message with hash: ${msg.parent_hash}`);
    //       }
    //     } catch (error) {
    //       console.error(`Error fetching parent message with hash ${msg.parent_hash}: ${error.message}`);
    //     }
    //   }
    // }

    // // Use the new function to load and filter relevant user profiles
    // const relevantUserProfiles = farcaster.loadAndFilterRelevantUserProfiles(relevantUsernames);


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
      const run = await runThread(threadId, [], authorUsername); // Step 2: Include userProfiles and authorUsername

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


module.exports = {
  handleRequiresAction,
  createNewThread,
  createMessage,
  runThread,
  generateImage,
  handleWebhook, // Export the webhook handler
};
