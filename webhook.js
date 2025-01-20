// webhook.js

const express = require('express');
const bodyParser = require('body-parser');
const { handleWebhook } = require('./assistant');
const { handleNiftyIslandWebhook } = require('./niftyHandler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// Endpoint to receive the webhook
app.post('/webhook', handleWebhook);
app.post('/niftyisland', handleNiftyIslandWebhook);

// Start the server
app.listen(PORT, () => {
  console.log(`Server is listening on http://localhost:${PORT}`);
});
