// xmtpServer.js

const { Client } = require('@xmtp/node-sdk');
const { createSigner, getEncryptionKeyFromHex, logAgentDetails, validateEnvironment } = require('./xmtpHelpers');
const { openai } = require('./client');
const { processXMTPMessage } = require('./assistant');
const { getConversationAnalytics } = require('./xmtpUtils');
const xmtpContext = require('./xmtpContext');
const { getOpenAIThreadId, saveOpenAIThreadId } = require('./threadUtils');
const { createNewThread, createMessage } = require('./assistant');

class XMTPServer {
  constructor() {
    this.client = null;
    this.isRunning = false;
    
    // Validate required environment variables
    const { PRIVATE_KEY, ENCRYPTION_KEY, XMTP_ENV } = validateEnvironment([
      'PRIVATE_KEY',
      'ENCRYPTION_KEY', 
      'XMTP_ENV',
    ]);
    
    this.walletKey = PRIVATE_KEY;
    this.encryptionKey = ENCRYPTION_KEY;
    this.xmtpEnv = XMTP_ENV || 'dev';
  }

  /**
   * Initialize the XMTP client
   */
  async initialize() {
    try {
      console.log('🚀 Initializing XMTP client...');
      
      // Create the signer and parse the encryption key
      const signer = createSigner(this.walletKey);
      const dbEncryptionKey = getEncryptionKeyFromHex(this.encryptionKey);

      // Create XMTP client
      this.client = await Client.create(signer, {
        dbEncryptionKey,
        env: this.xmtpEnv,
      });

      // Log agent details
      await logAgentDetails(this.client);

      console.log('✓ XMTP client initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Error initializing XMTP client:', error);
      throw error;
    }
  }

  /**
   * Start the XMTP message listener
   */
  async start() {
    if (!this.client) {
      throw new Error('XMTP client not initialized. Call initialize() first.');
    }

    if (this.isRunning) {
      console.log('⚠️ XMTP server is already running');
      return;
    }

    try {
      console.log('🔄 Syncing conversations...');
      await this.client.conversations.sync();

      console.log('👂 Starting XMTP message listener...');
      this.isRunning = true;

      // Stream all messages for AI responses
      this.client.conversations.streamAllMessages((error, message) => {
        if (error) {
          console.error('❌ Error in XMTP message stream:', error);
          return;
        }
        
        if (!message) {
          console.log('⚠️ No message received');
          return;
        }

        // Handle the message asynchronously
        this.handleMessage(message).catch(console.error);
      });

      console.log('✅ XMTP server started successfully');
      console.log(`📬 Listening for messages on ${this.xmtpEnv} network...`);
      
    } catch (error) {
      console.error('❌ Error starting XMTP server:', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Handle incoming XMTP messages
   * @param {Object} message - XMTP message object
   */
  async handleMessage(message) {
    try {
      // Ignore messages from the same agent or unsupported message types
      if (message.senderInboxId.toLowerCase() === this.client.inboxId.toLowerCase()) {
        return;
      }

      // Allow text and reply messages, filter out other types
      const allowedTypes = ['text', 'reply'];
      if (message.contentType?.typeId && !allowedTypes.includes(message.contentType.typeId)) {
        console.log(`⏸️ Skipping message with unsupported content type: ${message.contentType.typeId}`);
        return;
      }

      // Log the message type and content for debugging
      console.log(`📨 Received XMTP message (${message.contentType?.typeId || 'unknown'}): "${message.content}" from ${message.senderInboxId}`);
      
      // For reply messages, also log the fallback and structure for debugging
      if (message.contentType?.typeId === 'reply') {
        console.log(`🔄 Reply message details:`, {
          fallback: message.fallback,
          reference: message.parameters?.reference,
          hasContent: !!message.content
        });
      }

      // Get the conversation from the local db first
      const conversation = await this.client.conversations.getConversationById(
        message.conversationId,
      );

      if (!conversation) {
        console.log('⚠️ Unable to find conversation, skipping message');
        return;
      }

      // Check if we should respond to this message (now that conversation is available)
      const shouldRespond = await this.shouldRespondToMessage(conversation, message);
      
      if (!shouldRespond) {
        console.log(`⏸️ Not addressed to bot in group - adding to context only`);
        
        // Still add the message to OpenAI thread for context, but don't run it
        try {
          const extractedContent = this.extractMessageContent(message);
          const senderInfo = {
            username: message.senderInboxId.substring(0, 8),
            fid: message.senderInboxId,
          };
          
          // Add to thread without running for future context
          await this.addMessageToThread(extractedContent, senderInfo, conversation.id);
          console.log(`📝 Added context message from ${senderInfo.username}: "${extractedContent}"`);
        } catch (contextError) {
          console.error('⚠️ Error adding context message to thread:', contextError);
        }
        
        return;
      }

      // Set XMTP context for this conversation so the action handler can access it
      xmtpContext.setContext(this.client, conversation, message.conversationId);

      // Get conversation analytics if requested
      const messageText = message.content || message.fallback || '';
      if (messageText.toLowerCase().includes('/info') || 
          messageText.toLowerCase().includes('/conversation')) {
        try {
          console.log('📊 Getting conversation analytics...');
          const analytics = await getConversationAnalytics(conversation, this.client);
          
          if (analytics) {
            const report = this.formatConversationReport(analytics);
            await conversation.send(report);
            console.log('✅ Sent conversation analytics');
            return;
          }
        } catch (analyticsError) {
          console.error('❌ Error getting conversation analytics:', analyticsError);
        }
      }

      // Extract the actual message content for the assistant
      const extractedContent = this.extractMessageContent(message);

      // Create sender info object for the assistant
      const senderInfo = {
        username: message.senderInboxId.substring(0, 8), // Use first 8 chars of inbox ID as username
        fid: message.senderInboxId, // Use full inbox ID as fid
      };

      // Use the existing assistant functionality
      let response;
      try {
        response = await processXMTPMessage(extractedContent, senderInfo, conversation.id, this.client);
      } catch (assistantError) {
        console.error('⚠️ Error using assistant, falling back to basic OpenAI:', assistantError);
        
        // Fallback to basic OpenAI response
        const completion = await openai.chat.completions.create({
          messages: [{ role: 'user', content: extractedContent }],
          model: 'gpt-4o-mini',
          max_tokens: 1000,
        });

        response = completion.choices[0]?.message?.content || 
                  "Sorry, I encountered an error processing your message.";
      }

      console.log(`🤖 Sending XMTP response: "${response}"`);
      
      // Send the AI response to the conversation
      await conversation.send(response);
      
      console.log('✅ XMTP response sent successfully');

    } catch (error) {
      console.error('❌ Error handling XMTP message:', error);
      
      try {
        const conversation = await this.client.conversations.getConversationById(
          message.conversationId,
        );
        if (conversation) {
          await conversation.send('Sorry, I encountered an error processing your message.');
        }
      } catch (sendError) {
        console.error('❌ Error sending error message:', sendError);
      }
    } finally {
      // Clear XMTP context after handling the message
      xmtpContext.clearContext();
    }
  }

  /**
   * Stop the XMTP server
   */
  async stop() {
    if (!this.isRunning) {
      console.log('⚠️ XMTP server is not running');
      return;
    }

    this.isRunning = false;
    console.log('🛑 XMTP server stopped');
  }

  /**
   * Format conversation analytics into a readable report
   * @param {Object} analytics - Conversation analytics data
   * @returns {string} Formatted report
   */
  formatConversationReport(analytics) {
    const { info, participants, messageHistory, status } = analytics;
    
    let report = '📊 **Conversation Info**\n\n';
    
    // Basic info
    report += `🆔 **ID**: ${info.conversationId.substring(0, 8)}...\n`;
    report += `📅 **Created**: ${new Date(info.createdAt).toLocaleDateString()}\n`;
    report += `📱 **Type**: ${info.conversationType.toUpperCase()}\n`;
    report += `✅ **Status**: ${info.isActive ? 'Active' : 'Inactive'}\n\n`;
    
    // Participants
    report += `👥 **Participants**\n`;
    report += `• You: ${participants.self.inboxId.substring(0, 8)}...\n`;
    report += `• Peer: ${participants.peer.inboxId.substring(0, 8)}...\n`;
    if (participants.peer.installations) {
      report += `• Peer devices: ${participants.peer.installations}\n`;
    }
    report += '\n';
    
    // Message stats
    if (messageHistory?.stats) {
      const stats = messageHistory.stats;
      report += `💬 **Messages**\n`;
      report += `• Total: ${stats.totalMessages}\n`;
      
      if (stats.messagesByParticipant) {
        Object.entries(stats.messagesByParticipant).forEach(([sender, count]) => {
          const isYou = sender === participants.self.inboxId;
          report += `• ${isYou ? 'You' : 'Peer'}: ${count}\n`;
        });
      }
      
      if (stats.lastMessage) {
        report += `• Last: ${new Date(stats.lastMessage.timestamp).toLocaleString()}\n`;
      }
      report += '\n';
    }
    
    // Activity status
    if (status) {
      report += `⏱️ **Activity**\n`;
      if (status.conversationAge !== null) {
        report += `• Age: ${status.conversationAge} days\n`;
      }
      if (status.hoursSinceLastActivity !== undefined) {
        report += `• Last activity: ${status.hoursSinceLastActivity}h ago\n`;
      }
    }
    
    report += '\n_Send `/info` anytime to see this again_';
    
    return report;
  }

  /**
   * Determine if the bot should respond to a message
   * @param {Object} conversation - XMTP conversation object
   * @param {Object} message - XMTP message object
   * @returns {Promise<boolean>} Whether to respond to the message
   */
  async shouldRespondToMessage(conversation, message) {
    try {
      // Debug: Log conversation structure and try to find actual properties
      console.log(`🔍 DEBUG - Conversation structure:`, {
        id: conversation.id,
        topic: conversation.topic,
        peerInboxId: conversation.peerInboxId,
        members: conversation.members?.length || 'undefined',
        type: typeof conversation,
        keys: Object.keys(conversation),
        prototype: Object.getOwnPropertyNames(Object.getPrototypeOf(conversation)),
        constructor: conversation.constructor?.name
      });

      // Try to get more detailed conversation info
      try {
        console.log(`🔍 DEBUG - Attempting to get conversation details:`, {
          conversationType: conversation.conversationType,
          kind: conversation.kind,
          isGroup: conversation.isGroup,
          state: conversation.state,
          version: conversation.version,
          createdAt: conversation.createdAt,
        });
      } catch (e) {
        console.log(`🔍 DEBUG - Error getting conversation details:`, e.message);
      }

      // Check if this is a group conversation or 1-on-1
      const isGroupChat = this.isGroupConversation(conversation);
      
      console.log(`🎯 Conversation type detected: ${isGroupChat ? 'GROUP CHAT' : '1-ON-1'}`);
      
      if (!isGroupChat) {
        // In 1-on-1 conversations, always respond
        console.log(`💬 1-on-1 conversation: responding to all messages`);
        return true;
      }

      // In group chats, only respond if mentioned or replied to
      console.log(`👥 Group conversation: checking for mentions/replies`);
      
      // Extract content from message, handling different message types
      let messageContent;
      if (message.contentType?.typeId === 'reply') {
        // For reply messages, try to use the actual content, fallback to fallback text
        messageContent = typeof message.content === 'string' && message.content 
          ? message.content 
          : message.fallback || String(message.content);
      } else {
        // For regular text messages
        messageContent = typeof message.content === 'string' ? message.content : String(message.content);
      }

      const botAddress = this.client.accountIdentifier?.identifier?.toLowerCase();
      const botInboxId = this.client.inboxId.toLowerCase();
      
      console.log(`🔍 DEBUG - Checking mentions:`, {
        messageType: message.contentType?.typeId,
        messageContent,
        botAddress,
        botInboxId
      });
      
      // Check for mentions of bot address or inbox ID
      const isMentioned = this.isBotMentioned(messageContent, botAddress, botInboxId);
      
      // Check if this is a reply to the bot
      const isReplyToBot = await this.isReplyToBot(message);
      
      console.log(`🔍 DEBUG - Mention check results:`, {
        isMentioned,
        isReplyToBot
      });
      
      if (isMentioned || isReplyToBot) {
        console.log(`✅ Bot mentioned or replied to: ${isMentioned ? 'mentioned' : 'replied to'}`);
        return true;
      }
      
      console.log(`❌ Bot not mentioned or replied to in group chat`);
      return false;
      
    } catch (error) {
      console.error('Error checking if should respond:', error);
      // Default to responding if we can't determine
      return true;
    }
  }

  /**
   * Check if conversation is a group chat
   * @param {Object} conversation - XMTP conversation object
   * @returns {boolean} Whether this is a group conversation
   */
  isGroupConversation(conversation) {
    try {
      // XMTP v3: Check constructor name first (most reliable)
      if (conversation.constructor?.name === 'Group') {
        console.log(`✅ Group detected via constructor: ${conversation.constructor.name}`);
        return true;
      }
      
      // Check for group-specific methods in prototype
      const prototype = Object.getOwnPropertyNames(Object.getPrototypeOf(conversation));
      const groupMethods = ['addMembersByIdentifiers', 'removeMembers', 'addAdmin', 'removeSuperAdmin'];
      const hasGroupMethods = groupMethods.some(method => prototype.includes(method));
      
      if (hasGroupMethods) {
        console.log(`✅ Group detected via methods: ${groupMethods.filter(m => prototype.includes(m))}`);
        return true;
      }
      
      // Legacy checks (if needed for other XMTP versions)
      if (conversation.members && conversation.members.length > 2) {
        console.log(`✅ Group detected via member count: ${conversation.members.length}`);
        return true;
      }
      
      if (conversation.topic && conversation.topic.includes('group')) {
        console.log(`✅ Group detected via topic: ${conversation.topic}`);
        return true;
      }
      
      // If peerInboxId exists, it's likely 1-on-1
      if (conversation.peerInboxId) {
        console.log(`✅ 1-on-1 detected via peerInboxId: ${conversation.peerInboxId}`);
        return false;
      }
      
      // Default: assume 1-on-1 if we can't determine
      console.log(`⚠️ Cannot determine conversation type, defaulting to 1-on-1`);
      return false;
      
    } catch (error) {
      console.error('Error determining conversation type:', error);
      return false;
    }
  }

  /**
   * Check if bot is mentioned in message content
   * @param {string} messageContent - Message content to check
   * @param {string} botAddress - Bot's Ethereum address
   * @param {string} botInboxId - Bot's inbox ID
   * @returns {boolean} Whether bot is mentioned
   */
  isBotMentioned(messageContent, botAddress, botInboxId) {
    const content = messageContent.toLowerCase();
    
    // Prepare mention patterns based on actual bot identifiers
    const mentionPatterns = [];
    
    // 1. @mferGPT
    mentionPatterns.push('@mfergpt');
    
    // 2. Wallet address patterns (if available)
    if (botAddress) {
      const address = botAddress.toLowerCase();
      
      // Full address: @0x1234...
      mentionPatterns.push(`@${address}`);
      
      // Short address (first 8 chars): @0x210cdb
      if (address.length >= 8) {
        mentionPatterns.push(`@${address.substring(0, 8)}`);
      }
      
             // Truncated address: @0x210C...3a04 (first 6 + ... + last 4)
       if (address.length >= 10) {
         const truncatedDots = `@${address.substring(0, 6)}...${address.slice(-4)}`;
         const truncatedEllipsis = `@${address.substring(0, 6)}…${address.slice(-4)}`;
         mentionPatterns.push(truncatedDots);
         mentionPatterns.push(truncatedEllipsis);
       }
    }
    
    // 3. Inbox ID patterns (if available)
    if (botInboxId) {
      const inboxId = botInboxId.toLowerCase();
      
      // Full inbox ID: @7dbb4d48d45c58b02bacbc5c8a17fc9ed6f47e28857862d65ec1059e61e31d7c
      mentionPatterns.push(`@${inboxId}`);
      
      // Short inbox ID (first 8 chars): @7dbb4d48
      if (inboxId.length >= 8) {
        mentionPatterns.push(`@${inboxId.substring(0, 8)}`);
      }
      
             // Truncated inbox ID: @7dbb4d...e31d7c (first 6 + ... + last 6)
       if (inboxId.length >= 12) {
         const truncatedDots = `@${inboxId.substring(0, 6)}...${inboxId.slice(-6)}`;
         const truncatedEllipsis = `@${inboxId.substring(0, 6)}…${inboxId.slice(-6)}`;
         mentionPatterns.push(truncatedDots);
         mentionPatterns.push(truncatedEllipsis);
       }
    }
    
    // Log what we're checking for debugging
    console.log(`🔍 Bot identifiers:`, {
      address: botAddress,
      inboxId: botInboxId
    });
    console.log(`🔍 Checking mention patterns:`, mentionPatterns);
    
    const foundPattern = mentionPatterns.find(pattern => {
      if (!pattern) return false;
      const isMatch = content.includes(pattern.toLowerCase());
      if (isMatch) {
        console.log(`✅ Found mention pattern: "${pattern}" in "${content}"`);
      }
      return isMatch;
    });
    
    return !!foundPattern;
  }

  /**
   * Check if message is a reply to the bot
   * @param {Object} message - XMTP message object
   * @returns {Promise<boolean>} Whether message is a reply to bot
   */
  async isReplyToBot(message) {
    try {
      // For XMTP v3 reply messages, check if it's a reply type with reference
      if (message.contentType?.typeId === 'reply' && message.parameters?.reference) {
        console.log(`🔍 Checking if reply reference ${message.parameters.reference} is from bot...`);
        
        // Try to get the referenced message to see if it was from the bot
        try {
          const conversation = await this.client.conversations.getConversationById(message.conversationId);
          if (conversation) {
            // Get recent messages to find the referenced one
            const messages = await conversation.messages(50); // Get last 50 messages
            const referencedMessage = messages.find(msg => msg.id === message.parameters.reference);
            
            if (referencedMessage) {
              const isFromBot = referencedMessage.senderInboxId.toLowerCase() === this.client.inboxId.toLowerCase();
              console.log(`🎯 Referenced message found: ${isFromBot ? 'FROM BOT' : 'NOT FROM BOT'}`);
              return isFromBot;
            } else {
              console.log(`⚠️ Referenced message not found in recent messages`);
            }
          }
        } catch (lookupError) {
          console.log(`⚠️ Could not lookup referenced message:`, lookupError.message);
        }
        
        // Fallback: If it's a reply type message, assume it might be to the bot
        // This is safer than missing replies to the bot
        console.log(`🤔 Reply type detected but couldn't verify - assuming it's to bot for safety`);
        return true;
      }
      
      // Check message content/fallback for reply indicators to bot
      const messageContent = message.fallback || (typeof message.content === 'string' ? message.content : String(message.content));
      const replyIndicators = [
        'replying to',
        'replied with',
        'in response to',
        '> ', // Quote prefix
        'RE:',
      ];
      
      const hasReplyIndicator = replyIndicators.some(indicator => 
        messageContent.toLowerCase().includes(indicator.toLowerCase())
      );
      
      if (hasReplyIndicator) {
        console.log(`✅ Reply indicator found in content: "${messageContent}"`);
        return true;
      }
      
      return false;
      
    } catch (error) {
      console.error('Error checking if reply to bot:', error);
      return false;
    }
  }

  /**
   * Add a message to the OpenAI thread without running it (for context only)
   * @param {string} messageContent - The message content
   * @param {Object} senderInfo - Sender information
   * @param {string} conversationId - XMTP conversation ID
   */
  async addMessageToThread(messageContent, senderInfo, conversationId) {
    try {
      // Create a thread for this conversation (using sender's fid as thread identifier)
      const xmtpThreadId = `xmtp_${senderInfo.fid}`;
      let threadId = getOpenAIThreadId(xmtpThreadId);

      if (!threadId) {
        // No existing OpenAI thread, create a new one
        threadId = await createNewThread(`XMTP Chat with ${senderInfo.username || senderInfo.fid}`);
        
        // Save the new mapping
        saveOpenAIThreadId(xmtpThreadId, threadId);
        console.log(`Created new thread ${threadId} for XMTP conversation ${xmtpThreadId}`);
      }

      // Create a context message object (similar to processXMTPMessage but simpler)
      let contextMessageObject = {
        context: [
          "This is a context message from XMTP (not directly addressed to bot).",
          "This message is added for conversation context only.",
          `Message from ${senderInfo.username || senderInfo.fid} in group chat.`
        ],
        data: {
          messageContent: messageContent,
          senderUsername: senderInfo.username,
          senderFID: senderInfo.fid,
          platform: "XMTP",
          conversationId: conversationId,
          timestamp: new Date().toISOString(),
          contextOnly: true
        }
      };

      let contextMessage = JSON.stringify(contextMessageObject, null, 2);

      // Add message to thread but don't run it
      await createMessage(threadId, contextMessage);
      
      return threadId;
    } catch (error) {
      console.error('Error adding message to thread:', error);
      throw error;
    }
  }

  /**
   * Extract the actual message content for processing
   * @param {Object} message - XMTP message object
   * @returns {string} The extracted message content
   */
  extractMessageContent(message) {
    try {
      // For regular text messages, use content directly
      if (message.contentType?.typeId === 'text' && message.content) {
        return message.content;
      }
      
      // For reply messages, extract the quoted text from fallback
      if (message.contentType?.typeId === 'reply' && message.fallback) {
        // Pattern: 'Replied with "actual message" to an earlier message'
        const quotedTextMatch = message.fallback.match(/Replied with "(.+?)" to an earlier message/);
        if (quotedTextMatch && quotedTextMatch[1]) {
          console.log(`📝 Extracted reply content: "${quotedTextMatch[1]}" from fallback`);
          return quotedTextMatch[1];
        }
        
        // Fallback: try other patterns
        const altPattern = message.fallback.match(/"(.+?)"/);
        if (altPattern && altPattern[1]) {
          console.log(`📝 Extracted content via alt pattern: "${altPattern[1]}"`);
          return altPattern[1];
        }
        
        // If no quotes found, return the fallback text itself
        console.log(`⚠️ Could not extract quoted text, using fallback: "${message.fallback}"`);
        return message.fallback;
      }
      
      // Default fallback for any other cases
      const fallbackContent = message.content || message.fallback || 'No message content available';
      console.log(`⚠️ Using fallback content extraction: "${fallbackContent}"`);
      return fallbackContent;
      
    } catch (error) {
      console.error('Error extracting message content:', error);
      return message.content || message.fallback || 'Error reading message';
    }
  }

  /**
   * Get server status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      clientInitialized: !!this.client,
      environment: this.xmtpEnv,
      inboxId: this.client?.inboxId || null,
    };
  }
}

module.exports = { XMTPServer }; 