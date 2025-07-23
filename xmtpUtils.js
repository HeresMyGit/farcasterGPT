// xmtpUtils.js
// Utility functions for getting XMTP conversation metadata and participant information

const fs = require('fs');
const path = require('path');

// Cache for address-to-username mappings
const CACHE_FILE = path.join(__dirname, 'xmtp_username_cache.json');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Load username cache from disk
 * @returns {Object} Cache object with address mappings and timestamps
 */
function loadUsernameCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cacheData = fs.readFileSync(CACHE_FILE, 'utf8');
      return JSON.parse(cacheData);
    }
  } catch (error) {
    console.warn('⚠️ Error loading username cache:', error.message);
  }
  return {};
}

/**
 * Save username cache to disk
 * @param {Object} cache - Cache object to save
 */
function saveUsernameCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.warn('⚠️ Error saving username cache:', error.message);
  }
}

/**
 * Get cached username for an address
 * @param {string} address - Wallet address
 * @returns {string|null} Cached username or null if not found/expired
 */
function getCachedUsername(address) {
  const cache = loadUsernameCache();
  const normalizedAddr = address.toLowerCase();
  const entry = cache[normalizedAddr];
  
  if (entry && entry.timestamp && entry.username) {
    const age = Date.now() - entry.timestamp;
    if (age < CACHE_TTL) {
      console.log(`💾 Cache hit for ${normalizedAddr.slice(0, 8)}... → @${entry.username} (${Math.round(age / 1000 / 60)}min old)`);
      return entry.username;
    } else {
      console.log(`🕐 Cache expired for ${normalizedAddr.slice(0, 8)}... (${Math.round(age / 1000 / 60 / 60)}h old)`);
    }
  }
  
  return null;
}

/**
 * Cache username for an address
 * @param {string} address - Wallet address
 * @param {string} username - Farcaster username
 */
function cacheUsername(address, username) {
  const cache = loadUsernameCache();
  const normalizedAddr = address.toLowerCase();
  
  cache[normalizedAddr] = {
    username: username,
    timestamp: Date.now()
  };
  
  saveUsernameCache(cache);
  console.log(`💾 Cached ${normalizedAddr.slice(0, 8)}... → @${username}`);
}

/**
 * Cache multiple username mappings
 * @param {Object} mappings - Object with address -> username mappings
 */
function cacheUsernames(mappings) {
  const cache = loadUsernameCache();
  const timestamp = Date.now();
  
  Object.entries(mappings).forEach(([address, username]) => {
    const normalizedAddr = address.toLowerCase();
    cache[normalizedAddr] = {
      username: username,
      timestamp: timestamp
    };
  });
  
  saveUsernameCache(cache);
  console.log(`💾 Cached ${Object.keys(mappings).length} username(s)`);
}

/**
 * Clean up expired entries from the cache
 * @returns {number} Number of entries removed
 */
function cleanupExpiredCache() {
  const cache = loadUsernameCache();
  const now = Date.now();
  let removedCount = 0;
  
  Object.keys(cache).forEach(address => {
    const entry = cache[address];
    if (entry && entry.timestamp) {
      const age = now - entry.timestamp;
      if (age >= CACHE_TTL) {
        delete cache[address];
        removedCount++;
      }
    }
  });
  
  if (removedCount > 0) {
    saveUsernameCache(cache);
    console.log(`🧹 Cleaned up ${removedCount} expired cache entries`);
  }
  
  return removedCount;
}

/**
 * Get detailed conversation information
 * @param {Object} conversation - XMTP conversation object
 * @returns {Object} Conversation metadata
 */
async function getConversationInfo(conversation) {
  try {
    const info = {
      conversationId: conversation.id,
      topic: conversation.topic,
      createdAt: conversation.createdAt,
      state: conversation.state,
      peerInboxId: conversation.peerInboxId,
      isActive: conversation.state === 'active',
      conversationType: 'dm', // XMTP v3 primarily supports DMs
    };

    // Get message count
    try {
      const messages = await conversation.messages();
      info.messageCount = messages.length;
      
      if (messages.length > 0) {
        const messageContent = typeof messages[0].content === 'string' ? messages[0].content : 
                              typeof messages[0].content === 'object' ? JSON.stringify(messages[0].content) :
                              String(messages[0].content);
        info.lastMessage = {
          timestamp: messages[0].timestamp,
          senderInboxId: messages[0].senderInboxId,
          preview: messageContent.substring(0, 50) + (messageContent.length > 50 ? '...' : ''),
        };
      }
    } catch (messageError) {
      console.log('Could not fetch message count:', messageError.message);
      info.messageCount = 'unknown';
    }

    return info;
  } catch (error) {
    console.error('Error getting conversation info:', error);
    return null;
  }
}

/**
 * Get participant information for a conversation
 * @param {Object} conversation - XMTP conversation object
 * @param {Object} client - XMTP client
 * @returns {Object} Participant information
 */
async function getParticipants(conversation, client) {
  try {
    const participants = {
      self: {
        inboxId: client.inboxId,
        address: client.accountIdentifier?.identifier,
        role: 'self'
      },
      peer: {
        inboxId: conversation.peerInboxId,
        role: 'participant'
      }
    };

         // Try to get additional peer information
     try {
       // In XMTP v3, we can try to get inbox state - but this method might not work as expected
       // Skip for now as it's causing issues
       participants.peer.installations = 'unknown';
     } catch (inboxError) {
       console.log('Could not fetch peer inbox state:', inboxError.message);
       participants.peer.installations = 'unknown';
     }

    return participants;
  } catch (error) {
    console.error('Error getting participants:', error);
    return null;
  }
}

/**
 * Get message history and stats for a conversation
 * @param {Object} conversation - XMTP conversation object
 * @param {number} limit - Maximum number of messages to retrieve
 * @returns {Object} Message history and statistics
 */
async function getMessageHistory(conversation, limit = 50) {
  try {
    const messages = await conversation.messages(limit);
    
    const stats = {
      totalMessages: messages.length,
      messagesByParticipant: {},
      firstMessage: null,
      lastMessage: null,
      contentTypes: {},
    };

    if (messages.length > 0) {
      const firstMessageContent = typeof messages[messages.length - 1].content === 'string' ? messages[messages.length - 1].content : 
                                  typeof messages[messages.length - 1].content === 'object' ? JSON.stringify(messages[messages.length - 1].content) :
                                  String(messages[messages.length - 1].content);
      const lastMessageContent = typeof messages[0].content === 'string' ? messages[0].content : 
                                 typeof messages[0].content === 'object' ? JSON.stringify(messages[0].content) :
                                 String(messages[0].content);
      
      stats.firstMessage = {
        timestamp: messages[messages.length - 1].timestamp,
        sender: messages[messages.length - 1].senderInboxId,
        content: firstMessageContent.substring(0, 100)
      };
      
      stats.lastMessage = {
        timestamp: messages[0].timestamp,
        sender: messages[0].senderInboxId,
        content: lastMessageContent.substring(0, 100)
      };

      // Analyze messages
      messages.forEach(message => {
        // Count by participant
        const sender = message.senderInboxId;
        stats.messagesByParticipant[sender] = (stats.messagesByParticipant[sender] || 0) + 1;
        
        // Count content types
        const contentType = message.contentType?.typeId || 'text';
        stats.contentTypes[contentType] = (stats.contentTypes[contentType] || 0) + 1;
      });
    }

    return {
      messages: messages.slice(0, 10), // Return only first 10 for preview
      stats
    };
  } catch (error) {
    console.error('Error getting message history:', error);
    return null;
  }
}

/**
 * Get conversation status and activity info
 * @param {Object} conversation - XMTP conversation object
 * @param {Object} client - XMTP client
 * @returns {Object} Status information
 */
async function getConversationStatus(conversation, client) {
  try {
    const status = {
      isActive: conversation.state === 'active',
      canMessage: true, // Assume true unless we find otherwise
      lastActivity: null,
      conversationAge: null,
    };

    // Calculate conversation age
    if (conversation.createdAt) {
      const now = new Date();
      const created = new Date(conversation.createdAt);
      status.conversationAge = Math.floor((now - created) / (1000 * 60 * 60 * 24)); // days
    }

    // Get last activity
    try {
      const recentMessages = await conversation.messages(1);
      if (recentMessages.length > 0) {
        status.lastActivity = recentMessages[0].timestamp;
        
        const now = new Date();
        const lastMsg = new Date(recentMessages[0].timestamp);
        status.hoursSinceLastActivity = Math.floor((now - lastMsg) / (1000 * 60 * 60));
      }
    } catch (msgError) {
      console.log('Could not get recent messages for status:', msgError.message);
    }

    return status;
  } catch (error) {
    console.error('Error getting conversation status:', error);
    return null;
  }
}

/**
 * Get comprehensive conversation analytics
 * @param {Object} conversation - XMTP conversation object  
 * @param {Object} client - XMTP client
 * @returns {Object} Complete conversation analysis
 */
async function getConversationAnalytics(conversation, client) {
  try {
    console.log('🔍 Analyzing XMTP conversation...');
    
    const [info, participants, messageHistory, status] = await Promise.all([
      getConversationInfo(conversation),
      getParticipants(conversation, client),
      getMessageHistory(conversation, 100),
      getConversationStatus(conversation, client)
    ]);

    return {
      info,
      participants,
      messageHistory,
      status,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error getting conversation analytics:', error);
    return null;
  }
}

/**
 * Look up Farcaster usernames from wallet addresses using Neynar bulk-by-address API with caching
 * This function is specifically designed for XMTP usage
 * @param {string|string[]} addresses - Single address or array of addresses
 * @returns {Promise<Object>} Object mapping addresses to usernames
 */
async function lookupFarcasterUsernames(addresses) {
  try {
    // Ensure addresses is an array
    const addressArray = Array.isArray(addresses) ? addresses : [addresses];
    
    if (addressArray.length === 0) {
      return {};
    }
    
    console.log(`🟣 Looking up Farcaster usernames for ${addressArray.length} address(es)...`);
    
    const result = {};
    const uncachedAddresses = [];
    
    // First, check cache for each address
    addressArray.forEach(address => {
      const cachedUsername = getCachedUsername(address);
      if (cachedUsername) {
        result[address.toLowerCase()] = cachedUsername;
      } else {
        uncachedAddresses.push(address);
      }
    });
    
    console.log(`💾 Found ${Object.keys(result).length} cached, ${uncachedAddresses.length} need lookup`);
    
    // If we have uncached addresses, lookup via API
    if (uncachedAddresses.length > 0) {
      const axios = require('axios');
      
      // Join addresses with commas for the API call
      const addressString = uncachedAddresses.join(',');
      
      console.log(`🌐 API lookup for ${uncachedAddresses.length} address(es)...`);
      
      // Make the API call using direct HTTP request
      const response = await axios.get('https://api.neynar.com/v2/farcaster/user/bulk-by-address/', {
        params: {
          addresses: addressString,
          address_types: 'custody_address,verified_address' // Search both types
        },
        headers: {
          'accept': 'application/json',
          'x-api-key': process.env.NEYNAR_API_KEY
        }
      });
      
      const apiResults = {};
      
      if (response.data) {
        // The API returns an object where each address is a key with an array of users
        Object.entries(response.data).forEach(([address, users]) => {
          if (Array.isArray(users) && users.length > 0) {
            // Take the first user for each address
            const user = users[0];
            const normalizedAddr = address.toLowerCase();
            
            // Add to API results
            apiResults[normalizedAddr] = user.username;
            
            // Add to final result
            result[normalizedAddr] = user.username;
            
            console.log(`  ${normalizedAddr.slice(0, 8)}... → @${user.username}`);
          }
        });
        
        // Cache the new results
        if (Object.keys(apiResults).length > 0) {
          cacheUsernames(apiResults);
        }
        
        console.log(`✅ Found ${Object.keys(apiResults).length} new username(s) via API`);
      }
    }
    
    console.log(`🎯 Total resolved: ${Object.keys(result).length}/${addressArray.length} addresses`);
    return result;
    
  } catch (error) {
    console.warn(`⚠️ Farcaster username lookup failed:`, error.message);
    return {};
  }
}

/**
 * Enhanced display name resolver specifically for XMTP that prioritizes Farcaster usernames
 * @param {string} peerInboxId - The inbox ID to resolve
 * @param {Object} client - XMTP client
 * @returns {Promise<string>} Readable name (prioritizing Farcaster username) or fallback
 */
async function resolveXMTPDisplayName(peerInboxId, client) {
  try {
    console.log(`🔍 Resolving XMTP display name for inbox ID: ${peerInboxId.slice(0, 8)}...`);
    
    // Step 1: inboxId → wallet address
    const [state] = await client.preferences.inboxStateFromInboxIds([peerInboxId]);
    const addr = state?.identifiers?.[0]?.identifier;
    
    if (!addr) {
      console.log(`⚠️ No wallet address found for inbox ID ${peerInboxId.slice(0, 8)}`);
      return peerInboxId.slice(0, 8);
    }
    
    console.log(`🔍 Found wallet address: ${addr}`);
    
    // Step 2: Try Neynar bulk-by-address API first for XMTP users
    try {
      const farcasterUsernames = await lookupFarcasterUsernames([addr]);
      const username = farcasterUsernames[addr.toLowerCase()];
      
      if (username) {
        console.log(`✅ Found Farcaster username via bulk-by-address: @${username}`);
        return `@${username}`;
      }
    } catch (neynarError) {
      console.log(`⚠️ Neynar bulk lookup failed, falling back to other methods:`, neynarError.message);
    }
    
    // Step 3: Fallback to the existing bulletproof resolver
    const { resolveDisplayName } = require('./nameResolver.cjs');
    const displayName = await resolveDisplayName(addr);
    
    console.log(`✅ Resolved name via fallback resolver: ${displayName}`);
    return displayName;
    
  } catch (error) {
    console.log(`⚠️ Error in resolveXMTPDisplayName:`, error.message);
    // Ultimate fallback - truncated inbox ID
    return peerInboxId.slice(0, 6);
  }
}

module.exports = {
  getConversationInfo,
  getParticipants,
  getMessageHistory,
  getConversationStatus,
  getConversationAnalytics,
  lookupFarcasterUsernames,
  resolveXMTPDisplayName,
  getCachedUsername,
  cacheUsername,
  cacheUsernames,
  cleanupExpiredCache,
}; 