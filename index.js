// index.js

require('dotenv').config();
// Global error handlers to prevent unexpected crashes (e.g. intermittent XMTP
// DNS issues). These will log the error and keep the process alive.
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
});

require('./webhook');

// Initialize XMTP server
const { XMTPServer } = require('./xmtpServer');

async function startXMTPServer() {
  try {
    // Only start XMTP if the required environment variables are present
    if (process.env.PRIVATE_KEY && process.env.ENCRYPTION_KEY) {
      console.log('🚀 Starting XMTP server...');
      const xmtpServer = new XMTPServer();
      await xmtpServer.initialize();
      await xmtpServer.start();
      console.log('✅ XMTP server started successfully');
    } else {
      console.log('⚠️ XMTP environment variables not found. Skipping XMTP server startup.');
      console.log('💡 To enable XMTP, add ENCRYPTION_KEY to your .env file (PRIVATE_KEY already configured)');
    }
  } catch (error) {
    console.error('❌ Error starting XMTP server:', error);
    console.log('⚠️ Continuing without XMTP functionality...');
  }
}

// Start XMTP server
startXMTPServer();

setInterval(() => {
    const now = new Date();
    console.log(`${now.toLocaleString()}: MF-GPT APP-IS-UP`);
}, 5000);