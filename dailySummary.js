// daily_summary.js

const fs = require('fs');
const OpenAI = require('openai');
const { NeynarAPIClient } = require('@neynar/nodejs-sdk');
require('dotenv').config();
const fetch = require('node-fetch');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG,
});

// Initialize Neynar client
const neynarClient = new NeynarAPIClient(process.env.NEYNAR_API_KEY);

// Read the threadMapping.json file
const threadMapping = JSON.parse(fs.readFileSync('threadMappings.json', 'utf8'));

// Initialize an array to hold summaries
let summaries = [];

// Get today's date
const today = new Date().toISOString().split('T')[0];

// Main function
(async () => {
  for (const [farcasterThreadId, openaiThreadId] of Object.entries(threadMapping)) {
    try {
      // Get messages from Farcaster thread
      const farcasterMessages = await fetchFarcasterThreadMessages(farcasterThreadId);

      // Get messages from OpenAI thread
      const openaiMessages = await getOpenAIThreadMessages(openaiThreadId);

      // Use mferGPT to write a summary of what happened
      const summary = await generateSummary(farcasterMessages, openaiMessages);

      // Push the summary to the summaries array
      summaries.push({
        date: today,
        farcasterThreadId,
        openaiThreadId,
        summary,
      });
    } catch (error) {
      console.error(
        `Error processing threads Farcaster: ${farcasterThreadId}, OpenAI: ${openaiThreadId}:`,
        error
      );
    }
  }

  // Save the summaries to the daily summary file
  fs.writeFileSync('daily_summary.json', JSON.stringify(summaries, null, 2));

  console.log('Daily summary saved to daily_summary.json');
})();

// Functions

async function fetchFarcasterThreadMessages(castHash) {
  const url = `https://api.neynar.com/v2/farcaster/cast/conversation?identifier=${castHash}&type=hash&reply_depth=2&include_chronological_parent_casts=false&limit=20`;
  const options = {
    method: 'GET',
    headers: {
      accept: 'application/json',
      api_key: process.env.NEYNAR_API_KEY, // Use the API key from environment variables
    },
  };

  try {
    console.warn(`fetching farcaster thread: ${castHash}`)
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`Failed to fetch thread messages: ${response.statusText}`);
    }

    const data = await response.json();

    // Extract the main cast and direct replies
    const mainCast = data.conversation.cast;
    const directReplies = mainCast.direct_replies || [];

    // Combine the main cast and all direct replies into a single array
    const allMessages = [mainCast, ...directReplies];

    // Recursively gather messages from nested direct replies
    const gatherMessages = (replies) => {
      return replies.flatMap((reply) => {
        const nestedReplies = reply.direct_replies || [];
        return [reply, ...gatherMessages(nestedReplies)];
      });
    };

    // Get all nested messages
    const nestedMessages = gatherMessages(directReplies);

    // Combine main cast messages and nested messages
    const combinedMessages = [mainCast, ...nestedMessages];

    return combinedMessages;
  } catch (error) {
    console.error('Error fetching thread messages:', error.message);
    return [];
  }
}

async function getOpenAIThreadMessages(threadId) {
  try {
    const messages = await openai.beta.threads.messages.list(threadId);
    if (messages && messages.data && messages.data.length > 0) {
      return messages.data;
    } else {
      console.error('No messages found in the thread.');
      return [];
    }
  } catch (error) {
    console.error('Error fetching OpenAI thread messages:', error);
    return [];
  }
}

async function generateSummary(farcasterMessages, openaiMessages) {
  // Prepare the messages for summarization
  const farcasterText = farcasterMessages
    .map((msg) => `${msg.author.display_name}: ${msg.text}`)
    .join('\n');
  const openaiAssistantMessages = openaiMessages
    .filter((msg) => msg.role === 'assistant')
    .map((msg) => `Assistant: ${msg.content[0].text.value}`)
    .join('\n');
  const openaiUserMessages = openaiMessages
    .filter((msg) => msg.role === 'user')
    .map((msg) => `User: ${msg.content[0].text.value}`)
    .join('\n');

  // Prepare the prompt
  const prompt = `Summarize the following conversation between users on Farcaster and OpenAI assistant:

Farcaster Messages:
${farcasterText}

OpenAI Assistant Messages:
${openaiAssistantMessages}

OpenAI User Messages:
${openaiUserMessages}

Summary:
`;

  // Use OpenAI's API to generate the summary
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
      temperature: 0.7,
    });

    const summary = completion.choices[0].message.content;
    return summary;
  } catch (error) {
    console.error('Error generating summary:', error);
    return 'Summary could not be generated.';
  }
}
