// xmtpContext.js
// Context manager for XMTP client and conversation data

class XMTPContext {
  constructor() {
    this.currentClient = null;
    this.currentConversation = null;
    this.currentConversationId = null;
  }

  /**
   * Set the current XMTP context for a conversation
   */
  setContext(client, conversation, conversationId) {
    this.currentClient = client;
    this.currentConversation = conversation;
    this.currentConversationId = conversationId;
  }

  /**
   * Clear the current XMTP context
   */
  clearContext() {
    this.currentClient = null;
    this.currentConversation = null;
    this.currentConversationId = null;
  }

  /**
   * Check if we have a valid XMTP context
   */
  hasContext() {
    return !!(this.currentClient && this.currentConversation);
  }

  /**
   * Get the current context
   */
  getContext() {
    return {
      client: this.currentClient,
      conversation: this.currentConversation,
      conversationId: this.currentConversationId
    };
  }
}

// Export a singleton instance
const xmtpContext = new XMTPContext();

module.exports = xmtpContext; 