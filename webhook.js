// webhook.js

const express = require('express');
const bodyParser = require('body-parser');
const { handleWebhook } = require('./assistant');
const { handleNiftyIslandWebhook } = require('./niftyHandler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// Farcaster webhook endpoint
app.post('/webhook', handleWebhook);

// Nifty Island webhook endpoint
app.post('/niftyisland', handleNiftyIslandWebhook);

// Basic health check
app.get('/', (req, res) => {
  res.json({ status: 'Server running - Farcaster and Nifty Island webhooks active' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Farcaster webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`Nifty Island webhook endpoint: http://localhost:${PORT}/niftyisland`);
});
