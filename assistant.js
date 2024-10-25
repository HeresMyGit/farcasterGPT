require('dotenv').config(); // Load environment variables
const { OpenAI } = require('openai'); // Import OpenAI SDK
const { sendTweet } = require('./twitter'); // Import the sendTweet function

// Get your OpenAI Assistant credentials from environment variables
const { MODEL, ASST_MODEL, OPENAI_API_KEY } = process.env;

// Initialize OpenAI SDK with API key
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// Create a new thread (mirrors structure from assistant.js)
async function createNewThread(name) {
  try {
    const thread = await openai.beta.threads.create({
      // assistant_id: ASST_MODEL,
      // name: name || "New OpenAI Tweet Thread", // Optional name for the thread
    });

    if (!thread || !thread.id) {
      throw new Error('Failed to create a new thread due to an unexpected response format.');
    }

    console.log(`Created thread with ID: ${thread.id}`);
    return thread.id;
  } catch (error) {
    console.error('Error creating thread:', error.response ? error.response.data : error.message);
    throw new Error('An error occurred while creating a new thread.');
  }
}

// Add a message to a thread (mirrors structure from assistant.js)
async function createMessage(threadId, userMessage) {
  try {
    await openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content: userMessage,
    });
    console.log('Message created in thread:', threadId);
  } catch (error) {
    console.error('Error creating message:', error.response ? error.response.data : error.message);
  }
}

// Run the thread and get the assistant's response (mirrors structure from assistant.js)
async function runThread(threadId) {
  try {
    const run = await openai.beta.threads.runs.createAndPoll(threadId, {
      assistant_id: ASST_MODEL,
      model: MODEL,
    });

    // Check the status of the run
    if (run.status === 'completed') {
      console.log('Run completed successfully on thread:', threadId);
      const messages = await openai.beta.threads.messages.list(threadId);

      if (messages && messages.data && messages.data.length > 0) {
        const assistantMessages = messages.data.filter(msg => msg.role === 'assistant');

        if (assistantMessages.length === 0) {
          console.error('No assistant messages found.');
          return null;
        }

        // Get the latest assistant message
        const latestAssistantMessage = assistantMessages[0];
        if (latestAssistantMessage && latestAssistantMessage.content) {
          const botMessage = latestAssistantMessage.content;
          console.log(`Assistant's response: ${botMessage}`);
          return botMessage;
        } else {
          console.error('Assistant message content is not structured as expected.');
          return null;
        }
      } else {
        console.error('No messages found in the thread.');
        return null;
      }
    } else {
      console.error(`Run did not complete successfully. Status: ${run.status}`);
      return null;
    }
  } catch (error) {
    console.error('Error running thread:', error.response ? error.response.data : error.message);
    return null;
  }
}

// Main function to create a thread, add a message, run the assistant, and tweet the response
async function tweetAssistantResponse(prompt) {
  try {
    // Step 1: Create a new thread
    const threadId = await createNewThread('Tweet Assistant Thread');

    // Step 2: Add the user's prompt to the thread
    await createMessage(threadId, prompt);

    // Step 3: Run the assistant on the thread and get the response
    const assistantResponse = await runThread(threadId);

    if (assistantResponse) {
      // Step 4: Tweet the assistant's response
      // await sendTweet(assistantResponse);
      console.log('Tweet sent successfully!');
    } else {
      console.error('Failed to generate a valid assistant response.');
    }
  } catch (error) {
    console.error('Error during OpenAI and Twitter interaction:', error);
  }
}

// Example usage of the function
(async () => {
  const prompt = 'Your custom prompt goes here'; // You can replace this with a real prompt
  await tweetAssistantResponse(prompt);
})();