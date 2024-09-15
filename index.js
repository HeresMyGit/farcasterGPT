const express = require('express');
const bodyParser = require('body-parser');
const { NeynarAPIClient } = require('@neynar/nodejs-sdk');
const OpenAI = require('openai');
const { getOpenAIThreadId, saveOpenAIThreadId } = require('./threadUtils');
const { loadUserProfiles, saveUserProfiles } = require('./threadUtils');
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
          const { username } = JSON.parse(tool.function.arguments);
          const relevantUserProfiles = loadAndFilterRelevantUserProfiles([username]);
          
          // Check if we have the relevant profile loaded; if not, generate on the fly
          let userProfile;
          if (relevantUserProfiles && Object.keys(relevantUserProfiles).length > 0) {
            userProfile = relevantUserProfiles[username];
            console.log(`Loaded profile for ${username} from cache.`);
          } else {
            // Step 2: Generate the profile on the fly if not found
            console.warn(`Generating profile on the fly for ${username}...`);
            userProfile = await buildProfilOnTheFly(username);
            console.log(`Generated profile on the fly for ${username}.`);
          }
          return {
            tool_call_id: tool.id,
            output: JSON.stringify(userProfile), // Format the fetched profile data
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

const handleRunStatus = async (run) => {
  // Check if the run is completed
  if (run.status === "completed") {
    let messages = await client.beta.threads.messages.list(thread.id);
    // console.log(messages.data);
    return messages.data;
  } else if (run.status === "requires_action") {
    console.log(run.status);
    return await handleRequiresAction(run);
  } else {
    console.error("Run did not complete:", run);
  }
};

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
      // Try to create the message in the thread
      await openai.beta.threads.messages.create(threadId, {
        role: 'user',
        content: userMessage,
      });
      // console.log('Message created in thread:', threadId);
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
  if (userProfiles[authorUsername]) {
    const authorProfile = userProfiles[authorUsername];
    const { profile, popularCasts, recentCasts } = authorProfile;

    // Ensure that popularCasts and recentCasts are arrays before mapping
    const popularCastsList = Array.isArray(popularCasts) ? popularCasts.map(cast => ({ text: cast.text, timestamp: cast.timestamp, author: cast.author.username })) : [];
    const recentCastsList = Array.isArray(recentCasts) ? recentCasts.map(cast => ({ text: cast.text, timestamp: cast.timestamp, author: cast.author.username })) : [];

    // Add the author's profile to the list first
    allUserProfilesJson.push({
      profile: {
        username: profile.username,
        displayName: profile.display_name,
        bio: profile.profile.bio.text,
        followerCount: profile.follower_count,
        followingCount: profile.following_count
      },
      popularCasts: popularCastsList,
      recentCasts: recentCastsList
    });
  } else {
    console.warn(`No user profile found for the author ${authorUsername}.`);
  }

  // Add the other user profiles, skipping the author's profile since it's already added
  for (const [username, userProfile] of Object.entries(userProfiles)) {
    if (username === authorUsername) continue; // Skip the author's profile as it's already added

    const { profile, popularCasts, recentCasts } = userProfile;

    // Ensure that popularCasts and recentCasts are arrays before mapping
    const popularCastsList = Array.isArray(popularCasts) ? popularCasts.map(cast => ({ text: cast.text, timestamp: cast.timestamp, author: cast.author.username })) : [];
    const recentCastsList = Array.isArray(recentCasts) ? recentCasts.map(cast => ({ text: cast.text, timestamp: cast.timestamp, author: cast.author.username })) : [];

    // Add each user profile to the list
    allUserProfilesJson.push({
      profile: {
        username: profile.username,
        displayName: profile.display_name,
        bio: profile.profile.bio.text,
        followerCount: profile.follower_count,
        followingCount: profile.following_count
      },
      popularCasts: popularCastsList,
      recentCasts: recentCastsList
    });
  }

  // Convert all user profiles to a JSON string with indentation for readability
  const userContext = JSON.stringify(allUserProfilesJson, null, 2);

  while (attempt < maxRetries) {
    try {
      console.warn(`Running assistant on thread: ${threadId} (Attempt ${attempt + 1})`);

      // const instructions = `use the following user profiles as context for generating responses. these users were tagged in the thread or replied to the thread. remember that YOU are @mferGPT, do NOT respond to yourself. remember ur original instructions and type like sartoshi all lowercase and mfer-like. always keep your response under 320 bytes:\n${userContext}`;
      // console.log(`instructions: ${instructions}`);

      // Combine the instructions with the user context for better responses
      let run = await openai.beta.threads.runs.createAndPoll(threadId, {
        assistant_id: process.env.ASST_MODEL,
        model: process.env.MODEL,
        // instructions: instructions, // Add the user data here
      });

      // Check if the run has required actions
      if (run.status === 'requires_action') {
        console.log('requires action:', threadId);
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


// Utility function to fetch all messages in a Farcaster thread
async function fetchFarcasterThreadMessages(castHash) {
  console.warn(`fetch farcaster thread messages: ${castHash}`)
  const url = `https://api.neynar.com/v2/farcaster/cast/conversation?identifier=${castHash}&type=hash&reply_depth=2&include_chronological_parent_casts=false&limit=20`;
  const options = {
    method: 'GET',
    headers: {
      accept: 'application/json',
      api_key: process.env.NEYNAR_API_KEY,
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

    // Recursively gather messages from nested direct replies
    const gatherMessages = (replies) => {
      return replies.flatMap((reply) => {
        const nestedReplies = reply.direct_replies || [];
        return [reply, ...gatherMessages(nestedReplies)];
      });
    };

    // Get all nested messages
    const nestedMessages = gatherMessages(directReplies);

    // Combine main cast messages and nested messages
    const combinedMessages = [mainCast, ...nestedMessages];

    // **Update user profiles based on messages**
    await updateUserProfilesFromMessages(combinedMessages);

    // Combine messages into a single context string
    const context = combinedMessages
      .map((msg) => `${msg.author.display_name}: ${msg.text}`)
      .join('\n');

    console.log(
      `Fetched ${combinedMessages.length} messages from Farcaster thread with hash: ${castHash}`
    );

    return context;
  } catch (error) {
    console.error('Error fetching thread messages:', error.message);
    return '';
  }
}

async function fetchFarcasterThreadData(castHash) {
  console.warn(`fetch farcaster thread messages: ${castHash}`);
  const url = `https://api.neynar.com/v2/farcaster/cast/conversation?identifier=${castHash}&type=hash&reply_depth=2&include_chronological_parent_casts=false&limit=20`;
  const options = {
    method: 'GET',
    headers: {
      accept: 'application/json',
      api_key: process.env.NEYNAR_API_KEY,
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

    // Recursive function to gather messages from nested replies
    const gatherMessages = (replies) => {
      return replies.flatMap((reply) => {
        const nestedReplies = reply.direct_replies || [];
        return [reply, ...gatherMessages(nestedReplies)];
      });
    };

    // Get all nested messages
    const nestedMessages = gatherMessages(directReplies);

    // Combine main cast messages and nested messages into one list
    const combinedMessages = [mainCast, ...nestedMessages];

    // Return the combined list of main cast and replies
    return combinedMessages;

  } catch (error) {
    console.error('Error fetching thread messages:', error.message);
    return [];
  }
}

async function fetchMessageByHash(hash) {
  console.warn(`fetch message by hash: ${hash}`)
  const url = `https://api.neynar.com/v2/farcaster/cast?identifier=${hash}&type=hash`;
  const options = {
    method: 'GET',
    headers: {
      accept: 'application/json',
      api_key: process.env.NEYNAR_API_KEY,
    },
  };
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`Failed to fetch message by hash: ${response.statusText}`);
    }
    const data = await response.json();
    return data.cast;
  } catch (error) {
    console.error(`Error fetching message by hash ${hash}:`, error.message);
    return null;
  }
}

function extractUsernames(text, mentionedProfiles = []) {
  const regex = /@(\w+)/g;
  const matches = text.matchAll(regex);
  const usernames = new Set();

  // Add usernames found via regex
  for (const match of matches) {
    usernames.add(match[1]);
  }

  // Add usernames from the mentioned_profiles array
  mentionedProfiles.forEach(profile => {
    if (profile.username) {
      usernames.add(profile.username);
    }
  });

  return Array.from(usernames);
}

// Function to generate a consolidated profile including user profile, popular casts, and recent casts
async function buildProfilOnTheFly(username) {
  try {
    // Step 1: Fetch the user profile to get the FID
    const profile = await fetchUserProfile(username);

    // Check if the profile was fetched successfully
    if (!profile || !profile.fid) {
      console.error(`Could not find FID for username: ${username}`);
      return {
        profile: null,
        popularCasts: [],
        recentCasts: [],
        error: `User profile not found for ${username}`
      };
    }

    // Extract the FID from the profile
    const fid = profile.fid;

    // Step 2: Fetch popular and recent casts using the FID in parallel
    const [popularCasts, recentCasts] = await Promise.all([
      getPopularCasts(fid), // Fetch popular casts
      getRecentCasts(fid)   // Fetch recent casts
    ]);

    // Step 3: Structure the result into a consolidated dictionary
    const userProfileDetails = {
      profile: {
        username: profile.username,
        displayName: profile.display_name,
        bio: profile.profile?.bio?.text || "", // Handle cases where bio might be missing
        followerCount: profile.follower_count,
        followingCount: profile.following_count,
        pfpUrl: profile.pfp_url,
        verifications: profile.verifications,
        verifiedAddresses: profile.verified_addresses,
        activeStatus: profile.active_status,
        powerBadge: profile.power_badge
      },
      popularCasts: popularCasts.map(cast => ({
        text: cast.text,
        timestamp: cast.timestamp,
        author: cast.author.username
      })), // Ensure to map popular casts properly
      recentCasts: recentCasts.map(cast => ({
        text: cast.text,
        timestamp: cast.timestamp,
        author: cast.author.username
      })), // Ensure to map recent casts properly
    };

    return userProfileDetails;

  } catch (error) {
    console.error(`Error generating profile details for username "${username}":`, error.message);
    return {
      profile: null,
      popularCasts: [],
      recentCasts: [],
      error: error.message
    };
  }
}

// Function to fetch user profile
async function fetchUserProfile(query) {
  const url = `https://api.neynar.com/v2/farcaster/user/search?q=${query}&limit=5`;
  const options = {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'api_key': process.env.NEYNAR_API_KEY, // Ensure the API key is set in your environment variables
    },
  };

  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      console.error(`Failed to search for users: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    // Check if there are any users in the result and return the first one
    if (data.result && data.result.users && data.result.users.length > 0) {
      return data.result.users[0]; // Return the first user found
    } else {
      console.warn(`No users found for query: ${query}`);
      return null;
    }


  } catch (error) {
    console.error(`Error searching for users with query "${query}":`, error.message);
    return null;
  }
}


async function getPopularCasts(fid) {
  const url = `https://api.neynar.com/v2/farcaster/feed/user/popular?fid=${fid}`;
  const options = {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'api_key': process.env.NEYNAR_API_KEY,
    },
  };

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`Failed to fetch popular casts: ${response.statusText}`);
    }
    const data = await response.json();
    // Return only the first 3 results
    return data.casts.slice(0, 3);
  } catch (error) {
    console.error('Error fetching popular casts:', error);
    return [];
  }
}

async function getRecentCasts(fid) {
  const url = `https://api.neynar.com/v2/farcaster/feed/user/replies_and_recasts?fid=${fid}&filter=all&limit=3`;
  const options = {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'api_key': process.env.NEYNAR_API_KEY,
    },
  };

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`Failed to fetch recent casts: ${response.statusText}`);
    }
    const data = await response.json();
    return data.casts;
  } catch (error) {
    console.error('Error fetching recent casts:', error);
    return []
  }
}

// Function to generate user profile
async function generateUserProfile(username) {
  // Fetch the user profile to get the FID
  const profile = await fetchUserProfile(username);

  if (!profile || !profile.fid) {
    console.error(`Could not find FID for username: ${username}`);
    return {
      profile: null,
      popularCasts: [],
      recentCasts: [],
    };
  }

  const fid = profile.fid; // Use the correct path to access FID

  // Fetch popular and recent casts using the FID
  const popularCasts = await getPopularCasts(fid);
  const recentCasts = await getRecentCasts(fid);

  // Ensure popularCasts and recentCasts are arrays
  const validPopularCasts = Array.isArray(popularCasts) ? popularCasts : [];
  const validRecentCasts = Array.isArray(recentCasts) ? recentCasts : [];

  console.log(`Generating user profile for ${username}`);

  return {
    profile,
    popularCasts: validPopularCasts,
    recentCasts: validRecentCasts,
  };
}



// Function to update user profiles from messages
async function updateUserProfilesFromMessages(messages) {
  console.log('Starting updateUserProfilesFromMessages...');

  // Load existing user profiles
  const userProfiles = loadUserProfiles();

  // Collect all usernames from messages
  const allUsernames = new Set();

  // Build a mapping from message hash to message object
  const hashToMessage = {};
  messages.forEach((msg) => {
    if (msg.hash) {
      hashToMessage[msg.hash] = msg;
    }
  });

  for (const msg of messages) {
    console.log(`Processing message from ${msg.author ? msg.author.username : 'unknown author'} with hash ${msg.hash}...`);
    
    // Add author username
    if (msg.author && msg.author.username) {
      allUsernames.add(msg.author.username);
      console.log(`Added author username: ${msg.author.username}`);
    }

    // Extract tagged usernames from the message text
    const taggedUsernames = extractUsernames(msg.text, msg.mentioned_profiles);
    console.log(`Extracted tagged usernames: ${taggedUsernames.join(', ')}`);
    taggedUsernames.forEach((username) => {
      allUsernames.add(username);
      console.log(`Added tagged username: ${username}`);
    });

    // Get the user(s) that the message is replying to
    if (msg.parent_hash) {
      console.log(`Message has a parent hash: ${msg.parent_hash}`);
      const parentMsg = hashToMessage[msg.parent_hash];
      if (parentMsg && parentMsg.author && parentMsg.author.username) {
        allUsernames.add(parentMsg.author.username);
        console.log(`Added parent message author username: ${parentMsg.author.username}`);
      } else {
        // If parent message is not in the current messages, fetch it
        console.log(`Fetching parent message by hash: ${msg.parent_hash}`);
        try {
          const parentMsgData = await fetchMessageByHash(msg.parent_hash); // Ensure await is in async context
          if (parentMsgData && parentMsgData.author && parentMsgData.author.username) {
            allUsernames.add(parentMsgData.author.username);
            console.log(`Added fetched parent message author username: ${parentMsgData.author.username}`);
          } else {
            console.warn(`No author found for fetched parent message with hash: ${msg.parent_hash}`);
          }
        } catch (error) {
          console.error(`Error fetching parent message with hash ${msg.parent_hash}: ${error.message}`);
        }
      }
    }
  }

  console.log(`Total unique usernames collected: ${allUsernames.size}`);

  // Generate profiles for each user if not already present
  for (const username of allUsernames) {
    if (!userProfiles[username]) {
      console.log(`Generating profile for new username: ${username}`);
      try {
        const userProfile = await generateUserProfile(username);
        userProfiles[username] = userProfile;
        console.log(`Profile generated for ${username}`);
      } catch (error) {
        console.error(`Error generating profile for ${username}: ${error.message}`);
      }
    } else {
      console.log(`Profile already exists for ${username}, skipping generation.`);
    }
  }

  // Save updated user profiles
  saveUserProfiles(userProfiles);
  console.log('User profiles updated and saved successfully.');
}

function loadAndFilterRelevantUserProfiles(relevantUsernames) {
  // Load all user profiles
  console.log('Loading existing user profiles...');
  const userProfiles = loadUserProfiles();

  // Filter profiles to include only relevant usernames
  const filteredProfiles = {};

  relevantUsernames.forEach(username => {
    if (userProfiles[username]) {
      filteredProfiles[username] = userProfiles[username];
    }
  });

  return filteredProfiles;
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

    const authorUsername = hookData.data.author.username;

    // Check if the bot has already replied to this message
    if (repliedMessageHashes.has(messageHash)) {
      console.log(`Already replied to message hash: ${messageHash}. Skipping reply.`);
      res.status(200).send('Already replied to this message.');
      return;
    }

    // Add the message hash to the cache to avoid duplicate replies
    repliedMessageHashes.add(messageHash);

    const conversationContext = await fetchFarcasterThreadMessages(farcasterThreadId);

    // Collect relevant usernames from messages (author, mentions, replies)
    const relevantUsernames = new Set();

    const threadMessages = await fetchFarcasterThreadData(farcasterThreadId)

    // Iterate over messages to gather relevant usernames
    for (const msg of threadMessages) {
      console.log(`Processing message from ${msg.author ? msg.author.username : 'unknown author'} with hash ${msg.hash}...`);
      
      // Add author username
      if (msg.author && msg.author.username) {
        relevantUsernames.add(msg.author.username);
        console.log(`Added author username: ${msg.author.username}`);
      }

      // Extract tagged usernames from the message text
      const taggedUsernames = extractUsernames(msg.text, msg.mentioned_profiles);
      console.log(`Extracted tagged usernames: ${taggedUsernames.join(', ')}`);
      taggedUsernames.forEach((username) => {
        relevantUsernames.add(username);
        console.log(`Added tagged username: ${username}`);
      });

      // Get the user(s) that the message is replying to
      if (msg.parent_hash) {
        console.log(`Message has a parent hash: ${msg.parent_hash}`);
        
        // Fetch parent message by hash, ensuring the call is awaited
        try {
          const parentMsg = await fetchMessageByHash(msg.parent_hash); // Corrected: added await to handle async function
          if (parentMsg && parentMsg.author && parentMsg.author.username) {
            relevantUsernames.add(parentMsg.author.username);
            console.log(`Added fetched parent message author username: ${parentMsg.author.username}`);
          } else {
            console.warn(`No author found for fetched parent message with hash: ${msg.parent_hash}`);
          }
        } catch (error) {
          console.error(`Error fetching parent message with hash ${msg.parent_hash}: ${error.message}`);
        }
      }
    }

    // Use the new function to load and filter relevant user profiles
    const relevantUserProfiles = loadAndFilterRelevantUserProfiles(relevantUsernames);


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
      const run = await runThread(threadId, relevantUserProfiles, authorUsername); // Step 2: Include userProfiles and authorUsername

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