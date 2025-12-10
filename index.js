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

setInterval(() => {
  const now = new Date();
  console.log(`${now.toLocaleString()}: MF-GPT APP-IS-UP`);
}, 5000);

