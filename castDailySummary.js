// castDailySummary.js

const fs = require('fs');
const OpenAI = require('openai');
const { neynarClient } = require('./client');
const fetch = require('node-fetch'); // Include node-fetch
const path = require('path');
const { loadTrendingSummaries } = require('./threadUtils');
const { splitMessageIntoChunks } = require('./assistant')

require('dotenv').config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG,
});

const PREVIOUS_SUMMARIES_FILE = path.resolve(__dirname, '../farcasterGPT-Data/previous_summaries.json');

// Function to read daily summaries for the current day
function readDailySummaries() {
  const data = fs.readFileSync('daily_summary.json', 'utf8');
  const summaries = JSON.parse(data);
  const today = new Date().toISOString().split('T')[0];

  // Filter summaries with today's date
  return summaries//.filter(summary => summary.date === today);
}

// Function to read previous summaries, if any
function readPreviousSummaries() {
  if (fs.existsSync('previous_summaries.json')) {
    const data = fs.readFileSync('previous_summaries.json', 'utf8');
    return JSON.parse(data);
  } else {
    return [];
  }
}

// Utility function to run the Assistant on a thread with retry logic
async function runThread(threadId) {
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      console.warn(`Running assistant on thread: ${threadId} (Attempt ${attempt + 1})`);
      const run = await openai.beta.threads.runs.createAndPoll(threadId, {
        assistant_id: process.env.ASST_MODEL,
        model: process.env.MODEL,
      });

      if (run.status === 'completed') {
        console.log('Run completed successfully on thread:', threadId);
        return run;
      } else {
        console.error(`Run did not complete successfully. Status: ${run.status}`);
      }
    } catch (error) {
      console.error('Error running thread:', error.response ? error.response.data : error.message);
    }

    attempt++;
    if (attempt < maxRetries) {
      console.log('Waiting 5 seconds before retrying...');
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  throw new Error('Max retries reached. Failed to complete the assistant run.');
}

// Function to generate the daily post using the beta assistant
async function generateDailyPost(summaries, previousSummaries) {
  const todaySummariesText = summaries.map((s) => `- ${s.summary}`).join('\n');
  const previousSummariesText = previousSummaries.map((s) => `- ${s.summary}`).join('\n');

  const prompt = `Based on the following summaries of conversations that mferGPT was tagged in today on Farcaster, write a brief post summarizing what people were up to today involving mferGPT.

Today's Summaries:
${todaySummariesText}

Your post should be engaging and capture the main activities and topics discussed by the users and how they used mferGPT to achieve it.

Keep it under 768 bytes since this will be sent in a Farcaster message, so succinct points and brevity is key. Use emoji bullet points for topics.

The title or greeting of your post should somehow reference how these are threads mfergpt interacted with.

Post:
`;
  try {
    const thread = await openai.beta.threads.create({});

    const threadId = thread.id;

    await openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content: prompt,
    });

    const run = await runThread(threadId);

    if (run.status === 'completed') {
      const messages = await openai.beta.threads.messages.list(threadId);

      if (messages && messages.data && messages.data.length > 0) {
        const assistantMessages = messages.data.filter((msg) => msg.role === 'assistant');

        if (assistantMessages.length === 0) {
          console.error('No assistant messages found.');
          return 'No assistant response generated.';
        }

        const latestAssistantMessage = assistantMessages[0];
        if (
          latestAssistantMessage &&
          latestAssistantMessage.content &&
          latestAssistantMessage.content[0] &&
          latestAssistantMessage.content[0].text
        ) {
          const postContent = latestAssistantMessage.content[0].text.value;
          console.log(`Generated daily post using threadID ${threadId}`);
          return postContent;
        } else {
          console.error('Assistant message content is not structured as expected.');
          return 'Assistant message content is not structured as expected.';
        }
      } else {
        console.error('No messages found in the thread.');
        return 'No messages found in the thread.';
      }
    } else {
      console.error(`Run did not complete successfully. Status: ${run.status}`);
      return `Run did not complete successfully. Status: ${run.status}`;
    }
  } catch (error) {
    console.error('Error generating daily post:', error);
    return 'Could not generate daily post.';
  }
}

// Function to publish the post using direct HTTP request
async function publishPost(content, imageUrl = null) {
  try {
    const url = 'https://api.neynar.com/v2/farcaster/cast';
    const maxChunkSize = 768;

    // Split the message into chunks if it exceeds the byte limit
    const messageChunks = splitMessageIntoChunks(content, maxChunkSize);

    let previousReplyHash = null; // Used to thread the messages
    let isFirstChunk = true;

    for (const chunk of messageChunks) {
      // Include the image URL only in the first reply if it exists
      const currentReplyOptions = {
        replyTo: previousReplyHash,
        ...(isFirstChunk && imageUrl ? { embeds: [{ url: imageUrl }] } : {}), // Include image URL only in the first chunk
      };

      // Publish the cast using neynarClient
      const reply = await neynarClient.publishCast(
        process.env.SIGNER_UUID,  // Use the SIGNER_UUID from environment variables
        chunk,                    // The message chunk to be sent
        currentReplyOptions        // The reply options for threading
      );

      console.log('Reply sent:', chunk);

      // Update previousReplyHash to thread subsequent messages correctly
      previousReplyHash = reply.hash;

      // Set the flag to false after the first chunk is sent
      isFirstChunk = false;
    }
  } catch (error) {
    console.error('Error casting post:', error);
  }
}

async function castDailySummary() {
  const summaries = readDailySummaries();
  const previousSummaries = readPreviousSummaries();
  console.log("summaries: ", summaries)
  const dailyPostContent = await generateDailyPost(summaries, previousSummaries);

  // Create the formatted entry for the JSON file
  const newEntry = {
    date: new Date().toISOString().split('T')[0],
    farcasterThreadId: summaries[0]?.farcasterThreadId || 'unknown', // Use the first Farcaster thread ID or 'unknown' if none
    summary: dailyPostContent,
  };

  // Print the generated post to console
  console.log('Generated Daily Post:', newEntry);

  // Read existing posts, append the new entry, and write back to the file
  const existingPosts = readPreviousSummaries();
  existingPosts.push(newEntry);

  // Write the updated list of posts to the file
  fs.writeFileSync(PREVIOUS_SUMMARIES_FILE, JSON.stringify(existingPosts, null, 2));

  // Cast the post (uncomment to enable posting)
  await publishPost(dailyPostContent);
}

// trending

async function castTrendingSummary() {
  // Read the trending summaries using threadUtils function
  const summaries = loadTrendingSummaries();

  const trendingPostContent = await generateTrendingPost(summaries);

  // Create the formatted entry for the JSON file
  const newEntry = {
    date: new Date().toISOString().split('T')[0],
    summary: trendingPostContent,
  };

  // Optionally, save or append the new entry to a file if needed

  // Print the generated post to console
  console.log('Generated Trending Post:', newEntry);

  // Cast the post
  await publishPost(trendingPostContent);
}

async function generateTrendingPost(summaries) {
  const trendingSummariesText = summaries.map((s) => `- ${s.summary}`).join('\n');

  const prompt = `Based on the following summaries of trending conversations on Farcaster, write a brief post summarizing the current trending topics and discussions.

Trending Summaries:
${trendingSummariesText}

Your post should be engaging and capture the main activities and topics that are currently trending on Farcaster.

Keep it under 768 bytes since this will be sent in a Farcaster message, so succinct points and brevity are key. Use emoji bullet points for topics.

Post:
`;

  try {
    const thread = await openai.beta.threads.create({});

    const threadId = thread.id;

    // Send the prompt to the assistant
    await openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content: prompt,
    });

    // Run the assistant on the thread
    const run = await runThread(threadId);

    if (run.status === 'completed') {
      const messages = await openai.beta.threads.messages.list(threadId);

      if (messages && messages.data && messages.data.length > 0) {
        const assistantMessages = messages.data.filter((msg) => msg.role === 'assistant');

        if (assistantMessages.length === 0) {
          console.error('No assistant messages found.');
          return 'No assistant response generated.';
        }

        const latestAssistantMessage = assistantMessages[0];
        if (
          latestAssistantMessage &&
          latestAssistantMessage.content &&
          latestAssistantMessage.content[0] &&
          latestAssistantMessage.content[0].text
        ) {
          const postContent = latestAssistantMessage.content[0].text.value;
          console.log(`Generated daily post using threadID ${threadId}`);
          return postContent;
        } else {
          console.error('Assistant message content is not structured as expected.');
          return 'Assistant message content is not structured as expected.';
        }
      } else {
        console.error('No messages found in the thread.');
        return 'No messages found in the thread.';
      }
    } else {
      console.error(`Run did not complete successfully. Status: ${run.status}`);
      return `Run did not complete successfully. Status: ${run.status}`;
    }
  } catch (error) {
    console.error('Error generating trending post:', error);
    return 'Could not generate trending post.';
  }
}

module.exports = { castDailySummary, castTrendingSummary };