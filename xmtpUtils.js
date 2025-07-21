// xmtpUtils.js
// Utility functions for getting XMTP conversation metadata and participant information

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

module.exports = {
  getConversationInfo,
  getParticipants,
  getMessageHistory,
  getConversationStatus,
  getConversationAnalytics,
}; 