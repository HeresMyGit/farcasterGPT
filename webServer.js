require('dotenv').config();
const express = require('express');
const path = require('path');
const { openai } = require('./client');
const {
  getOpenAIThreadId,
  saveOpenAIThreadId,
} = require('./threadUtils');
const { handleRequiresAction } = require('./actionHandler');

const app = express();
const PORT = process.env.WEB_PORT || 3069;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve the font file
app.get('/fonts/SartoshiScript-Regular.otf', (req, res) => {
  res.sendFile(path.join(__dirname, 'SartoshiScript-Regular.otf'));
});

// Serve the 3D model
app.get('/models/mferGPT.glb', (req, res) => {
  res.sendFile(path.join(__dirname, 'mferGPT.glb'));
});

// Chat session storage (in-memory for simplicity)
const chatSessions = new Map();

// Create a new thread
async function createNewThread() {
  try {
    const thread = await openai.beta.threads.create({});
    if (!thread || !thread.id) {
      throw new Error('Failed to create a new thread');
    }
    console.log(`[WEB] Created thread with ID: ${thread.id}`);
    return thread.id;
  } catch (error) {
    console.error('[WEB] Error creating thread:', error.message);
    throw error;
  }
}

// Create a message in a thread
async function createMessage(threadId, userMessage) {
  const maxRetries = 5;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const runs = await openai.beta.threads.runs.list(threadId);
      const inProgressRun = runs.data.find(run => run.status === 'in_progress');
      
      if (inProgressRun) {
        console.log(`[WEB] Run in progress, waiting...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }

      const requiresActionRun = runs.data.find(run => run.status === 'requires_action');
      if (requiresActionRun) {
        console.log('[WEB] Handling required action');
        await handleRequiresAction(requiresActionRun, threadId);
        continue;
      }

      await openai.beta.threads.messages.create(threadId, {
        role: 'user',
        content: userMessage,
      });
      console.log('[WEB] Message created in thread:', threadId);
      return;
    } catch (error) {
      console.error(`[WEB] Error creating message (attempt ${attempt + 1}):`, error.message);
      await new Promise(resolve => setTimeout(resolve, 3000));
      attempt++;
    }
  }
  throw new Error('Failed to create message after retries');
}

// Run the thread
async function runThread(threadId, assistantId) {
  const maxRetries = 5;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      let runs = await openai.beta.threads.runs.list(threadId);
      let inProgressRun = runs.data.find(run => run.status === 'in_progress');
      
      if (inProgressRun) {
        console.log(`[WEB] Run already in progress, waiting...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }

      let requiresActionRun = runs.data.find(run => run.status === 'requires_action');
      while (requiresActionRun) {
        console.log('[WEB] Handling required action');
        requiresActionRun = await handleRequiresAction(requiresActionRun, threadId);
        runs = await openai.beta.threads.runs.list(threadId);
        requiresActionRun = runs.data.find(run => run.status === 'requires_action');
      }

      let run = await openai.beta.threads.runs.createAndPoll(threadId, {
        assistant_id: assistantId,
        model: process.env.MODEL,
      });

      while (run.status === 'requires_action') {
        console.log('[WEB] Run requires action');
        run = await handleRequiresAction(run, threadId);
      }

      if (run.status === 'completed') {
        console.log('[WEB] Run completed successfully');
        return run;
      } else {
        console.error(`[WEB] Run did not complete. Status: ${run.status}`);
      }
    } catch (error) {
      console.error('[WEB] Error running thread:', error.message);
    }

    attempt++;
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  throw new Error('Failed to complete run after retries');
}

// Chat API endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    console.log(`[WEB] Received message: "${message}" from session: ${sessionId}`);

    // Get or create thread for this session
    let threadId = chatSessions.get(sessionId);
    
    if (!threadId) {
      threadId = await createNewThread();
      chatSessions.set(sessionId, threadId);
    }

    // Build user message with context
    const userMessageObject = {
      instructions: [
        "You are chatting with a user on the mferGPT website.",
        "Keep responses concise but engaging.",
        "Be in character as mferGPT - lowercase, casual, mfer vibes."
      ],
      data: {
        platform: "website",
        messageText: message
      }
    };

    const userMessage = JSON.stringify(userMessageObject, null, 2);
    await createMessage(threadId, userMessage);

    // Use the Twitter assistant model for web chat
    const assistantModel = process.env.TWITTER_MODEL || process.env.ASST_MODEL;
    const run = await runThread(threadId, assistantModel);

    let botMessage = "sorry mfer, something went wrong. try again?";

    if (run && run.status === 'completed') {
      const messages = await openai.beta.threads.messages.list(run.thread_id);
      
      if (messages && messages.data && messages.data.length > 0) {
        const assistantMessages = messages.data.filter(msg => msg.role === 'assistant');
        if (assistantMessages.length > 0) {
          botMessage = assistantMessages[0].content[0].text.value;
          console.log(`[WEB] Generated response: ${botMessage.substring(0, 100)}...`);
        }
      }
    }

    res.json({ response: botMessage });
  } catch (error) {
    console.error('[WEB] Error processing chat:', error);
    res.status(500).json({ error: 'Failed to process message', response: "sorry mfer, my circuits got scrambled. try again in a sec" });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve index.html for all other routes (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`🌐 mferGPT Website running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`🌍 Public: https://mfergpt.lol`);
});

module.exports = app;

