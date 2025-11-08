// xmtp.js

require('dotenv').config();

// Global error handlers to prevent unexpected crashes (e.g. intermittent XMTP
// DNS issues). These will log the error and keep the process alive.
process.on('unhandledRejection', (reason) => {
  console.error('🔥 Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
});

const REQUIRED_ENV_VARS = ['PRIVATE_KEY', 'ENCRYPTION_KEY'];

function getMissingEnvVars() {
  return REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
}

function startHeartbeat() {
  return setInterval(() => {
    const now = new Date();
    console.log(`${now.toLocaleString()}: XMTP APP-IS-UP`);
  }, 5000);
}

async function startXMTPServer() {
  const missingEnvVars = getMissingEnvVars();

  if (missingEnvVars.length > 0) {
    console.log('⚠️ XMTP environment variables not found. Skipping XMTP server startup.');
    console.log(`💡 Missing variables: ${missingEnvVars.join(', ')}`);
    return null;
  }

  try {
    const { XMTPServer } = require('./xmtpServer');
    console.log('🚀 Starting XMTP server...');
    const xmtpServer = new XMTPServer();
    await xmtpServer.initialize();
    await xmtpServer.start();
    console.log('✅ XMTP server started successfully');
    return xmtpServer;
  } catch (error) {
    console.error('❌ Error starting XMTP server:', error);
    throw error;
  }
}

async function bootstrap() {
  try {
    const server = await startXMTPServer();

    if (!server) {
      console.log('ℹ️ XMTP server not started. Exiting.');
      return { server: null, heartbeat: null };
    }

    const heartbeat = startHeartbeat();
    return { server, heartbeat };
  } catch (error) {
    console.error('❌ Failed to bootstrap XMTP server:', error);
    throw error;
  }
}

if (require.main === module) {
  bootstrap()
    .then(({ heartbeat }) => {
      if (!heartbeat) {
        process.exit(0);
      }
    })
    .catch(() => {
      process.exit(1);
    });
}

module.exports = { startXMTPServer, bootstrap };
