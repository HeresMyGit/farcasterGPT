// webhook.js

const express = require('express');
const bodyParser = require('body-parser');
const { handleWebhook } = require('./assistant');
const { handleNiftyIslandWebhook } = require('./niftyHandler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// Middleware to check Nifty Island auth
const checkNiftyAuth = (req, res, next) => {
  const authHeader = req.headers['x-nifty-key'];
  
  if (!authHeader || authHeader !== process.env.NIFTY_WEBHOOK_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
};

// Farcaster webhook endpoint
app.post('/webhook', handleWebhook);

// Nifty Island webhook endpoint with auth middleware
app.post('/niftyisland', checkNiftyAuth, handleNiftyIslandWebhook);

// Basic health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'Server running',
    webhooks: {
      farcaster: 'active',
      niftyIsland: 'active'
    },
    xmtp: {
      status: 'Check /xmtp-status for details'
    }
  });
});

// XMTP status endpoint
app.get('/xmtp-status', (req, res) => {
  // This will be populated when XMTP server is running
  res.json({
    xmtp: {
      enabled: !!(process.env.PRIVATE_KEY && process.env.ENCRYPTION_KEY),
      environment: process.env.XMTP_ENV || 'dev',
      message: process.env.PRIVATE_KEY && process.env.ENCRYPTION_KEY 
        ? 'XMTP server should be running (check logs for details)'
        : process.env.PRIVATE_KEY 
          ? 'PRIVATE_KEY found, but ENCRYPTION_KEY missing. Run "npm run gen:xmtp-keys" to add it.'
          : 'XMTP keys not configured. Run "npm run gen:xmtp-keys" to generate them.'
    }
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Farcaster webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`Nifty Island webhook endpoint: http://localhost:${PORT}/niftyisland`);
});
