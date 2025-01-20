const express = require('express');
const bodyParser = require('body-parser');
const { handleNiftyIslandWebhook } = require('./niftyHandler');

const app = express();
const PORT = 3000;

// Middleware
app.use(bodyParser.json());

// Routes
app.post('/niftyisland', handleNiftyIslandWebhook);

// Basic health check
app.get('/', (req, res) => {
  res.json({ status: 'Nifty Island test server running' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Nifty Island test server running on http://localhost:${PORT}`);
  console.log(`Send POST requests to http://localhost:${PORT}/nifty-webhook`);
  console.log('\nExample curl command:');
  console.log(`
curl -X POST http://localhost:${PORT}/nifty-webhook \\
-H "Content-Type: application/json" \\
-d '{
  "text": "Hello there!",
  "userName": "TestUser",
  "userId": "123",
  "version": "0.1"
}'`);
}); 