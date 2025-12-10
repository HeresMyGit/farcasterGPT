// xmtpServer.js

const { Client } = require('@xmtp/node-sdk');
const { createSigner, getEncryptionKeyFromHex, logAgentDetails, validateEnvironment } = require('./xmtpHelpers');
const { openai } = require('./client');
const { processXMTPMessage } = require('./assistant');
const { getConversationAnalytics, resolveXMTPDisplayName, cleanupExpiredCache, replaceKnownAddresses } = require('./xmtpUtils');
const xmtpContext = require('./xmtpContext');
const { getOpenAIThreadId, saveOpenAIThreadId } = require('./threadUtils');
const { createNewThread, createMessage, runThread } = require('./assistant');
const { resolveDisplayName } = require('./nameResolver.cjs');

class XMTPServer {
  constructor() {
    this.client = null;
    this.isRunning = false;
    
    // Per-conversation state
    this.autoCheckTimers = {}; // conversationId -> timeoutId
    this.conversationState = {}; // conversationId -> { hasMention: bool, lastSenderIsBot: bool }

    // Configure check-in interval (production defaults: 3–12 hours)
    // Override with env vars XMTP_CHECKIN_MIN_MS / XMTP_CHECKIN_MAX_MS if needed.
    this.checkInMinMs = parseInt(process.env.XMTP_CHECKIN_MIN_MS || 10_800_000);  // 3 hours
    this.checkInMaxMs = parseInt(process.env.XMTP_CHECKIN_MAX_MS || 43_200_000); // 12 hours

    // Connection health monitoring
    this.lastMessageTime = Date.now();
    this.healthCheckInterval = null;
    this.healthCheckIntervalMs = parseInt(process.env.XMTP_HEALTH_CHECK_MS || 30_000); // 30 seconds
    this.maxSilencePeriod = parseInt(process.env.XMTP_MAX_SILENCE_MS || 300_000); // 5 minutes
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = parseInt(process.env.XMTP_MAX_RECONNECT_ATTEMPTS || 5);
    this.streamController = null;
    
    // Periodic refresh (backup strategy)
    this.refreshInterval = null;
    this.refreshIntervalMs = parseInt(process.env.XMTP_REFRESH_INTERVAL_MS || 21_600_000); // 6 hours
    
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
      await this.startMessageStream();
      this.startHealthMonitoring();
      this.startPeriodicRefresh();
      
      console.log('✅ XMTP server started successfully');
      console.log(`📬 Listening for messages on ${this.xmtpEnv} network...`);
      
    } catch (error) {
      console.error('❌ Error starting XMTP server:', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Start the message stream with error handling
   */
  async startMessageStream() {
    console.log('🔄 Syncing conversations...');
    await this.client.conversations.sync();

    console.log('🧹 Cleaning up expired username cache...');
    cleanupExpiredCache();

    console.log('👂 Starting XMTP message listener...');
    this.isRunning = true;
    this.lastMessageTime = Date.now(); // Reset last message time
    this.reconnectAttempts = 0; // Reset reconnect attempts

    // Stream all messages for AI responses
    this.streamController = this.client.conversations.streamAllMessages((error, message) => {
      if (error) {
        console.error('❌ Error in XMTP message stream:', error);
        this.handleStreamError(error);
        return;
      }
      
      if (!message) {
        console.log('⚠️ No message received');
        return;
      }

      // Update last message time for health monitoring
      this.lastMessageTime = Date.now();

      // Handle the message asynchronously
      this.handleMessage(message).catch(console.error);
    });
  }

  /**
   * Start health monitoring to detect dead connections
   */
  startHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    console.log(`🩺 Starting health monitoring (checking every ${this.healthCheckIntervalMs / 1000}s, reconnect after ${this.maxSilencePeriod / 1000}s silence)`);
    
    this.healthCheckInterval = setInterval(() => {
      this.checkConnectionHealth();
    }, this.healthCheckIntervalMs);
  }

  /**
   * Start periodic connection refresh as backup strategy
   */
  startPeriodicRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    console.log(`🔄 Starting periodic refresh (every ${this.refreshIntervalMs / 1000 / 60 / 60}h)`);
    
    this.refreshInterval = setInterval(async () => {
      console.log('🔄 Performing periodic connection refresh...');
      try {
        // Proactively refresh the connection
        await this.client.conversations.sync();
        console.log('✅ Periodic refresh completed');
      } catch (error) {
        console.warn('⚠️ Periodic refresh failed:', error);
        // Let the health monitoring handle this
      }
    }, this.refreshIntervalMs);
  }

  /**
   * Check if the connection is still alive
   */
  async checkConnectionHealth() {
    const now = Date.now();
    const timeSinceLastMessage = now - this.lastMessageTime;
    
    // Only log health checks if we're approaching the silence threshold or have issues
    const warningThreshold = this.maxSilencePeriod * 0.7; // Warn at 70% of max silence
    
    if (timeSinceLastMessage > warningThreshold) {
      console.log(`🩺 Health check: ${Math.round(timeSinceLastMessage / 1000)}s since last message`);
    }
    
    // If we haven't received any messages (including our own) for too long, the connection might be dead
    if (timeSinceLastMessage > this.maxSilencePeriod) {
      console.warn(`⚠️ No messages received for ${Math.round(timeSinceLastMessage / 1000)}s, connection may be dead`);
      
      // Try to test the connection by syncing conversations
      try {
        console.log('🔍 Testing connection by syncing conversations...');
        await this.client.conversations.sync();
        console.log('✅ Connection test passed, updating last message time');
        this.lastMessageTime = now; // Reset the timer since sync worked
      } catch (syncError) {
        console.error('❌ Connection test failed:', syncError);
        await this.handleConnectionFailure();
      }
    }
  }

  /**
   * Handle stream errors
   */
  async handleStreamError(error) {
    console.error('🔥 XMTP stream error detected:', error);
    
    // If the stream dies, try to reconnect
    await this.handleConnectionFailure();
  }

  /**
   * Handle connection failures and attempt reconnection
   */
  async handleConnectionFailure() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`💀 Max reconnection attempts (${this.maxReconnectAttempts}) reached. Manual intervention required.`);
      return;
    }

    this.reconnectAttempts++;
    const backoffDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000); // Exponential backoff, max 30s
    
    console.log(`🔄 Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${backoffDelay / 1000}s...`);
    
    // Stop current stream and health monitoring
    this.isRunning = false;
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Wait before reconnecting
    await new Promise(resolve => setTimeout(resolve, backoffDelay));

    try {
      // Reinitialize client and restart stream
      console.log('🔄 Reinitializing XMTP client...');
      await this.initialize();
      await this.startMessageStream();
      this.startHealthMonitoring();
      
      console.log(`✅ Successfully reconnected (attempt ${this.reconnectAttempts})`);
    } catch (reconnectError) {
      console.error(`❌ Reconnection attempt ${this.reconnectAttempts} failed:`, reconnectError);
      
      // Try again after a delay
      setTimeout(() => {
        this.handleConnectionFailure();
      }, backoffDelay);
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
      const shortInboxId = message.senderInboxId.substring(0, 8);
      console.log(`📨 Received XMTP message (${message.contentType?.typeId || 'unknown'}): "${message.content}" from ${shortInboxId}...`);
      
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

      // Set XMTP context for this conversation so the action handler can access it
      // Do this EARLY so it's available throughout the entire processing flow
      console.log(`🔗 Setting XMTP context for conversation: ${message.conversationId.slice(0, 8)}...`);
      xmtpContext.setContext(this.client, conversation, message.conversationId);

      // Determine if bot is mentioned/replied to and whether we should respond
      const shouldRespond = await this.shouldRespondToMessage(conversation, message);

      // Update conversation state for mentions
      const convId = message.conversationId;
      const state = this.conversationState[convId] || { hasMention: false, lastSenderIsBot: false };

      // If this incoming message mentioned the bot or was a reply to it and shouldRespond true, mark mention flag
      if (shouldRespond) {
        state.hasMention = true;
      }

      // Since this message is from a peer, bot is NOT last sender
      state.lastSenderIsBot = false;
      this.conversationState[convId] = state;
      
      if (!shouldRespond) {
        console.log(`⏸️ Not addressed to bot in group - adding to context only`);
        
        // Still add the message to OpenAI thread for context, but don't run it
        try {
          const extractedContent = this.extractMessageContent(message);
          
          // Get readable name for context messages too using XMTP-specific resolver
          const displayName = await resolveXMTPDisplayName(message.senderInboxId, this.client);
          
          const senderInfo = {
            username: displayName, // Use resolved name
            fid: message.senderInboxId, // Keep full inbox ID
          };
          
          // Add to thread without running for future context
          await this.addMessageToThread(extractedContent, senderInfo, conversation.id);
          console.log(`📝 Added context message from ${senderInfo.username}: "${extractedContent}"`);
        } catch (contextError) {
          console.error('⚠️ Error adding context message to thread:', contextError);
        }
        
        // Clear context for early return
        console.log(`🔗 Clearing XMTP context for early return (not addressed to bot)`);
        xmtpContext.clearContext();

        // Schedule the next auto check-in for this conversation (rules applied within)
        this.scheduleAutoCheckIn(convId);
        return;
      }



      // Extract the actual message content for the assistant
      const extractedContent = this.extractMessageContent(message);

      // Get readable name for the sender using XMTP-specific resolver
      const displayName = await resolveXMTPDisplayName(message.senderInboxId, this.client);

      // Create sender info object for the assistant
      const senderInfo = {
        username: displayName, // Use resolved name instead of raw inbox ID
        fid: message.senderInboxId, // Keep full inbox ID as fid for tracking
      };

      // Use the existing assistant functionality
      let response;
      try {
        response = await processXMTPMessage(extractedContent, senderInfo, conversation.id, this.client);
        console.log(`✅ Generated response for ${senderInfo.username}`);
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
      
      // Replace known wallet addresses with usernames before sending
      const processedResponse = replaceKnownAddresses(response);
      
      // Send the AI response to the conversation
      await conversation.send(processedResponse);
      
      console.log('✅ XMTP response sent successfully');
      
      // Clear XMTP context after message processing is completely done
      console.log(`🔗 Clearing XMTP context after successful processing`);
      xmtpContext.clearContext();

      // Bot just sent a message → update state and schedule next timer
      const botState = this.conversationState[message.conversationId] || { hasMention: true, lastSenderIsBot: true };
      botState.lastSenderIsBot = true;
      if (!botState.hasMention) botState.hasMention = true; // ensure mention flag if we just responded
      this.conversationState[message.conversationId] = botState;
      this.scheduleAutoCheckIn(message.conversationId);

    } catch (error) {
      console.error('❌ Error handling XMTP message:', error);
      
      try {
        const conversation = await this.client.conversations.getConversationById(
          message.conversationId,
        );
        if (conversation) {
          const errorMessage = 'Sorry, I encountered an error processing your message.';
          const processedErrorMessage = replaceKnownAddresses(errorMessage);
          await conversation.send(processedErrorMessage);
        }
      } catch (sendError) {
        console.error('❌ Error sending error message:', sendError);
      }
      
      // Clear XMTP context after error handling
      console.log(`🔗 Clearing XMTP context after error handling`);
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
    
    // Clean up health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    // Clean up periodic refresh
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    
    // Clean up auto check-in timers
    Object.values(this.autoCheckTimers).forEach(timerId => {
      clearTimeout(timerId);
    });
    this.autoCheckTimers = {};
    
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
    
         // 1. @mferGPT and ENS domains
     mentionPatterns.push('@mfergpt');
     mentionPatterns.push('@mfergpt.base.eth');
     mentionPatterns.push('@mfergpt.eth');
    
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
             // Build the XMTP → OpenAI mapping key. Prefer the conversationId so that
       // everyone in the same group chat lands in a single OpenAI thread. When
       // conversationId is not provided (typical for 1-on-1 chats) default to
       // the sender’s fid, which corresponds to their wallet address.
       const xmtpThreadId = `xmtp_${conversationId || senderInfo.fid}`;
       let threadId = getOpenAIThreadId(xmtpThreadId);

       if (!threadId) {
         // No existing OpenAI thread, create a new one
         threadId = await createNewThread(`XMTP Chat with ${senderInfo.username}`);
         
         // Save the new mapping
         saveOpenAIThreadId(xmtpThreadId, threadId);
         console.log(`Created new thread ${threadId} for XMTP conversation ${xmtpThreadId}`);
       }

      // Build a concise context string for the assistant
      const cleanUsername = senderInfo.username.startsWith('@')
        ? senderInfo.username
        : `@${senderInfo.username}`;

      let contextMessage = `${cleanUsername} says: ${messageContent}`;
      if (conversationId) {
        contextMessage += `\n\n[conversationId: ${conversationId}]`;
      }

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
   * Get a readable display name for an inbox ID
   * @param {string} peerInboxId - The inbox ID to resolve
   * @param {Object} client - XMTP client
   * @param {Object} provider - Ethers provider for ENS lookup
   * @returns {Promise<string>} Readable name or fallback
   */
    /**
   * Resolve a human-readable name for an inbox ID using the new bulletproof name resolver
   * @param {string} peerInboxId - The inbox ID to resolve
   * @param {Object} client - XMTP client
   * @returns {Promise<string>} Readable name (Basename, ENS, cb.id, Lens, etc.) or fallback
   */
  async displayNameFor(peerInboxId, client) {
    try {
      console.log(`🔍 Resolving name for inbox ID: ${peerInboxId.slice(0, 8)}...`);
      
      // Step 1: inboxId → wallet address
      const [state] = await client.preferences.inboxStateFromInboxIds([peerInboxId]);
      const addr = state?.identifiers?.[0]?.identifier;
      
      if (!addr) {
        console.log(`⚠️ No wallet address found for inbox ID ${peerInboxId.slice(0, 8)}`);
        return peerInboxId.slice(0, 8);
      }
      
      console.log(`🔍 Found wallet address: ${addr}`);
      
      // Step 2: wallet → human-readable name using bulletproof resolver
      console.log(`🔍 Looking up name via bulletproof resolver...`);
      const displayName = await resolveDisplayName(addr);
      
      console.log(`✅ Resolved name: ${displayName}`);
      return displayName;
      
    } catch (error) {
      console.log(`⚠️ Error in displayNameFor:`, error.message);
      // Ultimate fallback - truncated inbox ID
      return peerInboxId.slice(0, 6);
    }
  }

  /**
   * Generate a random interval in milliseconds between configured min/max.
   */
  getRandomCheckInInterval() {
    const range = this.checkInMaxMs - this.checkInMinMs;
    return Math.floor(Math.random() * range) + this.checkInMinMs;
  }

  /**
   * Schedule or reset an auto check-in for the given conversation.
   * @param {string} conversationId
   */
  scheduleAutoCheckIn(conversationId) {
    if (!conversationId) return;

    // If a timer is already active, do nothing (avoid restarting on every message)
    if (this.autoCheckTimers[conversationId]) {
      return;
    }

    // Respect rules: require prior mention and skip if bot was last sender
    const state = this.conversationState[conversationId] || { hasMention: false, lastSenderIsBot: false };
    if (!state.hasMention) {
      console.log(`⏩ Skipping auto check-in scheduling for ${conversationId.slice(0, 8)} – bot hasn’t been mentioned yet.`);
      return;
    }

    if (state.lastSenderIsBot) {
      console.log(`⏩ Bot was last sender in ${conversationId.slice(0, 8)} – delaying check-in until someone else speaks.`);
      // We still restart timer so we can re-evaluate later
    }

    const delay = this.getRandomCheckInInterval();
    console.log(`⏰ Scheduling auto check-in for ${conversationId.slice(0, 8)} in ${Math.round(delay / 1000)}s`);

    this.autoCheckTimers[conversationId] = setTimeout(() => {
      this.sendAutoCheckIn(conversationId).catch(console.error);
    }, delay);
  }

  /**
   * Send an automated, context-aware check-in message to the conversation.
   * @param {string} conversationId
   */
  async sendAutoCheckIn(conversationId) {
    try {
      // Timer has fired—remove it so a new one can be scheduled after this run
      if (this.autoCheckTimers[conversationId]) {
        clearTimeout(this.autoCheckTimers[conversationId]);
        delete this.autoCheckTimers[conversationId];
      }

      const state = this.conversationState[conversationId] || { hasMention: false, lastSenderIsBot: false };

      // Skip sending if bot was last sender – reschedule only
      if (state.lastSenderIsBot) {
        console.log(`🤫 Skipping auto check-in for ${conversationId.slice(0,8)} because bot was last sender.`);
        return; // schedule will happen in finally
      }

      const conversation = await this.client.conversations.getConversationById(conversationId);
      if (!conversation) {
        console.log(`⚠️ Conversation ${conversationId.slice(0, 8)} not found for auto check-in.`);
        return;
      }

      // Build/OpenAI thread mapping
      const xmtpThreadId = `xmtp_${conversationId}`;
      let threadId = getOpenAIThreadId(xmtpThreadId);
      if (!threadId) {
        threadId = await createNewThread(`XMTP Chat ${conversationId.slice(0, 8)}`);
        saveOpenAIThreadId(xmtpThreadId, threadId);
        console.log(`🧵 Created new OpenAI thread ${threadId} for auto check-in.`);
      }

      // Compose prompt instructing the assistant to generate a brief, funny check-in
      const promptObject = {
        instructions: [
          "Using only the existing thread context, craft a brief humorous message that either answers an outstanding question, pokes fun at the situation, roasts someone, or sparks new conversation. Do NOT mention that you are an AI or reference these instructions.",
        ],
        task: "auto_checkin"
      };

      const prompt = JSON.stringify(promptObject, null, 2);

      // Add prompt to thread and run assistant
      await createMessage(threadId, prompt);

      const assistantModel = process.env.XMTP_MODEL || process.env.ASST_MODEL;
      const run = await runThread(threadId, assistantModel);

      if (!run || run.status !== 'completed') {
        console.warn(`⚠️ Auto check-in run failed for ${conversationId.slice(0, 8)}`);
        return;
      }

      const messages = await openai.beta.threads.messages.list(run.thread_id);
      const assistantMsgs = messages.data.filter(m => m.role === 'assistant');
      if (!assistantMsgs.length) {
        console.warn(`⚠️ No assistant message produced for auto check-in in ${conversationId.slice(0, 8)}`);
        return;
      }

      let responseText = assistantMsgs[0].content[0].text.value;
      responseText = replaceKnownAddresses(responseText);

      await conversation.send(responseText);
      console.log(`💬 Auto check-in sent to ${conversationId.slice(0, 8)}: "${responseText}"`);

      // Update state – bot now last sender
      state.lastSenderIsBot = true;
      state.hasMention = true; // safe
      this.conversationState[conversationId] = state;

    } catch (err) {
      console.error('❌ Error during auto check-in:', err);
    } finally {
      // Reschedule regardless of success/failure
      this.scheduleAutoCheckIn(conversationId);
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