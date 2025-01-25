const { openai } = require('./client');
const {
  getNiftyThreadForUser,
  saveNiftyThread,
} = require('./threadUtils');
const { createNewThread, createMessage, runThread } = require('./assistant');

// Helper function to validate and normalize actions
function validateAction(action) {
  const actionMap = {
    'NONE': 'CHAT',
    'TALK': 'CHAT',
    'CONTINUE': 'CHAT',
    'SPEAK': 'CHAT',
    'DANCE': 'EMOTE',
    'HOST': 'HOSTLOBBY',
    'LOBBY': 'HOSTLOBBY'
  };

  // Convert to uppercase for consistency
  action = action.toUpperCase();
  
  // Return mapped action or original if no mapping exists
  return actionMap[action] || action;
}

async function handleNiftyIslandWebhook(req, res) {
  try {
    console.log('Nifty Island webhook data:', JSON.stringify(req.body, null, 2));

    const { text, userName, userId, version } = req.body;

    // Check version compatibility
    if (version !== '0.1') {
      console.warn(`[Nifty] Received unexpected version: ${version}`);
    }

    let threadId;
    
    // Check for the special message that triggers new thread creation
    const forceNewThread = text.includes("new-custom-knowledge1234");
    
    // Create new thread if we have niftyKnowledge or the special message is detected
    if (forceNewThread) {
      threadId = await createNewThread(`Nifty Island Chat - ${userName}`);
      // Save/update the thread mapping for this user
      saveNiftyThread(userName, threadId);
      
      // Create initial message with knowledge injection
      const initialMessage = {
        instructions: [
          `User message: ${text}`
        ],
        data: {
          text,
          userName,
          userId,
          version
        }
      };
      
      await createMessage(threadId, JSON.stringify(initialMessage, null, 2));
    } else {
      // Check for existing thread
      threadId = getNiftyThreadForUser(userName);
      
      if (!threadId) {
        // Create new thread if none exists
        threadId = await createNewThread(`Nifty Island Chat - ${userName}`);
        saveNiftyThread(userName, threadId);
      }
      
      // Simple message format for continuing conversation
      await createMessage(threadId, JSON.stringify({
        data: {
          text,
          userName,
          userId,
          version
        }
      }, null, 2));
    }

    const run = await runThread(threadId, process.env.NIFTY_MODEL);

    // Default fallback response
    let responseObject = {
      text: "sorry mfer my circuits got scrambled, pls try again in a minute",
      action: "CHAT"
    };

    if (run && run.status === 'completed') {
      const messages = await openai.beta.threads.messages.list(run.thread_id);
      if (messages?.data?.length) {
        const assistantMessages = messages.data.filter(msg => msg.role === 'assistant');
        if (assistantMessages.length > 0) {
          const responseText = assistantMessages[0].content[0].text.value;
          
          try {
            // Parse the response as a single object
            const parsed = JSON.parse(responseText);
            
            // Normalize the response format
            responseObject = {
              text: parsed.text || responseText,
              action: validateAction(parsed.action || "CHAT"),
              ...(parsed.actionContext && { actionContext: parsed.actionContext })
            };
          } catch (err) {
            // If parsing fails, use the raw text as a chat message
            console.error('[Nifty] Error parsing response:', err);
            responseObject = {
              text: responseText,
              action: "CHAT"
            };
          }
        }
      }
    }

    // Clean the response and wrap it in an array
    const cleanResponse = [{
      text: String(responseObject.text).trim(),
      action: validateAction(responseObject.action || "CHAT"),
      ...(responseObject.actionContext && { actionContext: responseObject.actionContext })
    }];

    // Send the response
    return res.json(cleanResponse);
  } catch (error) {
    console.error('[Nifty] Error in handleNiftyIslandWebhook:', error);
    return res.json([{
      text: "An error occurred with the Nifty Island webhook.",
      action: "CHAT"
    }]);
  }
}

module.exports = {
  handleNiftyIslandWebhook
};