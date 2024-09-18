// farcaster.js

const fetch = require('node-fetch');
const axios = require('axios');
const { neynarClient } = require('./client');
const {
  loadUserProfiles,
  saveUserProfiles,
  getOpenAIThreadId,
  saveOpenAIThreadId,
} = require('./threadUtils');

// Farcaster-related functions

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
    // await updateUserProfilesFromMessages(combinedMessages);

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
  const url = `https://api.neynar.com/v2/farcaster/cast/conversation?identifier=${castHash}&type=hash&reply_depth=4&include_chronological_parent_casts=true&limit=20`;
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
async function buildProfileOnTheFly(username, shouldFetchLatestCasts = false, shouldFetchPopularCasts = false) {
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

    // Step 2: Fetch popular and recent casts using the FID in parallel if required
    const fetchPopularCasts = shouldFetchPopularCasts ? getPopularCasts(fid) : Promise.resolve([]);
    const fetchRecentCasts = shouldFetchLatestCasts ? getRecentCasts(fid) : Promise.resolve([]);

    const [popularCasts, recentCasts] = await Promise.all([
      fetchPopularCasts, // Conditionally fetch popular casts
      fetchRecentCasts   // Conditionally fetch recent casts
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
        powerBadge: profile.power_badge,
        fid: profile.fid
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
  console.warn("Getting popular casts...")
  const url = `https://api.neynar.com/v2/farcaster/feed/user/popular?fid=${fid}&limit=3`;
  console.warn(`url: ${url}`)
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
    console.warn("Got popular casts.")
    return data.casts;
  } catch (error) {
    console.error('Error fetching popular casts:', error);
    return []
  }
}

async function getRecentCasts(fid) {
  console.warn("Getting recent casts...")
  const url = `https://api.neynar.com/v2/farcaster/feed/user/replies_and_recasts?fid=${fid}&filter=all&limit=3`;
  console.warn(`url: ${url}`)
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
    console.warn("Got recent casts.")
    return data.casts;
  } catch (error) {
    console.error('Error fetching recent casts:', error);
    return []
  }
}

// Function to build channel details on the fly using getChannelDetails and getTrendingCasts
async function buildChannelDetailsOnTheFly(channelId, shouldFetchTrendingCasts = false) {
  try {
    // Step 1: Fetch the channel details
    const channelDetails = await getChannelDetails(channelId);

    // Check if the channel details were fetched successfully
    if (!channelDetails || channelDetails.length === 0) {
      console.error(`Could not find details for channel ID: ${channelId}`);
      return {
        channel: null,
        trendingCasts: [],
        error: `Channel details not found for ID: ${channelId}`
      };
    }

    // Extract the first channel as the relevant channel
    const channel = channelDetails[0];

    // Step 2: Conditionally fetch trending casts for the channel if shouldFetchTrendingCasts is true
    const trendingCasts = shouldFetchTrendingCasts ? await getTrendingCasts(channelId) : [];

    // Step 3: Structure the result into a consolidated dictionary
    const channelDetailsResult = {
      channel: {
        id: channel.id,
        name: channel.name,
        description: channel.description,
        followerCount: channel.followerCount,
        url: channel.url,
        imageUrl: channel.imageUrl,
        lead: {
          username: channel.lead.username,
          displayName: channel.lead.displayName,
          bio: channel.lead.bio,
          followerCount: channel.lead.followerCount,
          verifiedAddresses: channel.lead.verifiedAddresses,
          powerBadge: channel.lead.powerBadge,
        }
      },
      trendingCasts: trendingCasts.map(cast => ({
        text: cast.text,
        timestamp: cast.timestamp,
        author: cast.author.username,
        likesCount: cast.reactions.likesCount,
        recastsCount: cast.reactions.recastsCount,
        embeds: cast.embeds,
        repliesCount: cast.repliesCount,
      }))
    };

    return channelDetailsResult;

  } catch (error) {
    console.error(`Error generating channel details for channel ID "${channelId}":`, error.message);
    return {
      channel: null,
      trendingCasts: [],
      error: error.message
    };
  }
}

// Function to fetch Farcaster channel details based on a search query
async function getChannelDetails(query) {
  console.warn(`Fetching channel details for query: ${query}`);
  const url = `https://api.neynar.com/v2/farcaster/channel/search?q=${encodeURIComponent(query)}&limit=3`;
  const options = {
    method: 'GET',
    headers: {
      accept: 'application/json',
      api_key: process.env.NEYNAR_API_KEY, // Ensure the API key is set correctly
    },
  };

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`Failed to fetch channel details: ${response.statusText}`);
    }
    const data = await response.json();
    console.warn("Fetched channel details successfully.");

    // Map the relevant data from the response
    const channels = data.channels.map(channel => ({
      id: channel.id,
      name: channel.name,
      description: channel.description,
      followerCount: channel.follower_count,
      url: channel.url,
      imageUrl: channel.image_url,
      createdAt: channel.created_at,
      lead: {
        username: channel.lead.username,
        displayName: channel.lead.display_name,
        bio: channel.lead.profile?.bio?.text || "",
        followerCount: channel.lead.follower_count,
        verifiedAddresses: channel.lead.verified_addresses.eth_addresses || [],
        powerBadge: channel.lead.power_badge,
      },
    }));

    return channels;
  } catch (error) {
    console.error(`Error fetching channel details for query "${query}":`, error.message);
    return [];
  }
}

// Function to fetch trending Farcaster casts from a specific channel
async function getTrendingCasts(channelId, limit = 5, timeWindow = '7d') {
  console.warn(`Fetching trending casts for channel ID: ${channelId}`);
  const url = `https://api.neynar.com/v2/farcaster/feed/trending?limit=${limit}&time_window=${timeWindow}&channel_id=${channelId}&provider=neynar`;
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
      throw new Error(`Failed to fetch trending casts: ${response.statusText}`);
    }
    const data = await response.json();
    console.warn("Fetched trending casts successfully.");

    // Process the data as needed, e.g., log or return it
    return data.casts.map(cast => ({
      hash: cast.hash,
      text: cast.text,
      author: {
        username: cast.author.username,
        displayName: cast.author.display_name,
        pfpUrl: cast.author.pfp_url,
        bio: cast.author.profile.bio.text,
      },
      timestamp: cast.timestamp,
      reactions: {
        likesCount: cast.reactions.likes_count,
        recastsCount: cast.reactions.recasts_count,
      },
      embeds: cast.embeds,
      repliesCount: cast.replies.count,
      channel: cast.channel.name,
    }));
  } catch (error) {
    console.error(`Error fetching trending casts for channel "${channelId}":`, error.message);
    return [];
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

module.exports = {
  fetchFarcasterThreadMessages,
  fetchFarcasterThreadData,
  fetchMessageByHash,
  extractUsernames,
  buildProfileOnTheFly,
  buildChannelDetailsOnTheFly,
  fetchUserProfile,
  getPopularCasts,
  getRecentCasts,
  generateUserProfile,
  updateUserProfilesFromMessages,
  loadAndFilterRelevantUserProfiles,
};
