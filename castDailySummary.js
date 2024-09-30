// castDailySummary.js

const fs = require('fs');
const OpenAI = require('openai');
const farcaster = require('./farcaster');
const { neynarClient } = require('./client');
const fetch = require('node-fetch'); // Include node-fetch
const path = require('path');
const { loadTrendingSummaries } = require('./threadUtils');
const { splitMessageIntoChunks } = require('./assistant')
const { generateImage } = require('./image.js');
const { interpretUrl } = require('./attachments.js');

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
async function publishPost(content, replyToHash = null, imageUrl, castIdHash = null, castIdFid = null) {
  try {
    content = removeHamTip()
    const url = 'https://api.neynar.com/v2/farcaster/cast';
    const maxChunkSize = 768;

    // Split the message into chunks if it exceeds the byte limit
    const messageChunks = splitMessageIntoChunks(content, maxChunkSize);

    let previousReplyHash = replyToHash; // Start with the image cast hash if provided
    let isFirstChunk = true;

    for (const chunk of messageChunks) {
      const currentReplyOptions = {
        replyTo: previousReplyHash,  // Reply to the previous cast hash
        channelId: "mfergpt",
        embeds: [
          ...(isFirstChunk && imageUrl ? [{ url: imageUrl }] : []), // Add image URL if it's the first chunk
          ...(castIdHash && castIdFid ? [{ cast_id: { hash: castIdHash, fid: castIdFid } }] : []) // Add cast_id embed if provided
        ]
      };

      // Publish the cast using neynarClient
      // const reply = await neynarClient.publishCast(
      //   process.env.SIGNER_UUID,  // Use the SIGNER_UUID from environment variables
      //   chunk,                    // The message chunk to be sent
      //   currentReplyOptions        // The reply options for threading
      // );

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

function removeHamTip(inputString) {
    // Regular expression to find the rating in the format RATE:number/5 without brackets for the match,
    // but still replace the entire thing if surrounded by brackets
    const ratingRegex = /\[.*RATE:(\d)\/5.*\]/;

    // Search for the rating in the input string
    const match = inputString.match(ratingRegex);

    if (match) {
        // Replace the whole part surrounded by brackets with the ham tip
        const outputString = inputString.replace(ratingRegex, ``);

        return outputString;
    } else {
        // If no rating is found, return the original string
        return inputString;
    }
}

async function castDailyMeme(channel) {
  try {
    // Fetch trending casts from farcaster
    let trendingCasts = await farcaster.getTrendingCasts("mfers", 1, "6h");
    
    // Ensure that there is at least one cast
    if (!trendingCasts || trendingCasts.length === 0) {
      console.log('No trending casts available.');
      return;
    }

    // Get the first cast
    let firstCast = trendingCasts[0];
    
    let embeddedCastText = null;
    let interpretedUrlText = null;
    
    // Check if there's an embedded cast
    if (firstCast.embeds && firstCast.embeds.length > 0) {
      // Assuming we're only concerned with the first embed
      const embed = firstCast.embeds[0];
      
      if (embed.cast_id && embed.cast_id.hash) {
        // Fetch the embedded cast by its hash
        const embeddedCast = await farcaster.fetchMessageByHash(embed.cast_id.hash);
        
        if (embeddedCast && embeddedCast.text) {
          embeddedCastText = `Embedded Cast: "${embeddedCast.text}"\n`;
        }
      }

      // Handle embedded URL and use interpretUrl function
      if (embed.url) {
        const interpretedUrl = await interpretUrl(embed.url);
        interpretedUrlText = `Interpreted URL: "${interpretedUrl}"\n`;
      }
    }

    // Prepare the meme prompt using the text from the first cast and embedded cast if available
    let prompt = `Generate a hilarious meme image-prompt based in the mfer/farcaster/nft/art/meme universe about the following cast, give subjects mfer gear like cigs and headphones. Do NOT create an image, ONLY return the text prompt (do not acknowledge me, etc). \n\nMain Cast: "${firstCast.text}"`;
    if (embeddedCastText != null) {
      prompt = prompt + `\n\nQuoted cast: ${embeddedCastText}`
    }
    if (interpretedUrlText != null) {
      prompt = prompt + `\n\nInterpreted Url or Image: ${interpretedUrlText}`
    }
    
    console.log(`Meme Prompt: ${prompt}`);
    
    // Generate the meme image based on the prompt (assuming generateAndCastImage handles this)
    const imageUrl = await generateAndCastImage(null, prompt, "thread_3A1Y3VRxUv58ZeM0ABqHcKpH");

    // Log the generated image for verification
    console.log('Generated Daily Meme Image URL:', imageUrl);

    // Define the daily post content (optional, adjust if needed)
    const dailyPostContent = "hey mfer, here's today's meme!";

    // Cast the text post as a reply to the image cast (assuming publishPost handles this)
    await publishPost(dailyPostContent, null, imageUrl, firstCast.hash, firstCast.author.fid);

  } catch (error) {
    console.error('Error casting daily meme:', error);
  }
}

async function castDailySummary() {
  const summaries = readDailySummaries();
  const previousSummaries = readPreviousSummaries();

  const dailyPostContent = await generateDailyPost(summaries, previousSummaries);

  // Generate and cast the image first, and get the cast hash
  const imageUrl = await generateAndCastImage(dailyPostContent);


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

  // Cast the text post as a reply to the image cast
  await publishPost(dailyPostContent, null, imageUrl);
}

// trending

async function castTrendingSummary() {
  // Read the trending summaries using threadUtils function
  const summaries = loadTrendingSummaries();

  const trendingPostContent = await generateTrendingPost(summaries);

  // Generate and cast the image first, and get the cast hash
  const imageUrl = await generateAndCastImage();


  // Create the formatted entry for the JSON file
  const newEntry = {
    date: new Date().toISOString().split('T')[0],
    summary: trendingPostContent,
  };

  // Optionally, save or append the new entry to a file if needed

  // Print the generated post to console
  console.log('Generated Trending Post:', newEntry);

  // Cast the text post as a reply to the image
  await publishPost(trendingPostContent, null, imageUrl);
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

async function generateAndCastImage(summaries, prompt, memeThread) {
  // Step 1: Create the prompt for the assistant model
  let gptPrompt = ''

  if (summaries != null) {
    gptPrompt = `
    Generate a prompt for an image (do NOT attempt to create an image, just return the text prompt).  The main focus of the image is always a robot mfer (stick figure wearing headphone smoking a cigarette) helping a bunch of mfers out in farcaster.  Include elements from the daily summaries at the end of this message (examples: an item in the background, a topical piece of clothing, computers showing websites, etc).
    
    Summaries:
    ${summaries}
  `;
} else if (prompt != null) {
  gptPrompt = prompt
} else {
  gptPrompt = `
    Generate a prompt for an image (do NOT attempt to create an image, just return the text prompt).  The main focus of the image is always a robot mfer (stick figure wearing headphone smoking a cigarette) saying "gm farcaster" in an inspiring morning scene.`
}

  // Step 2: Call the assistant's beta model to generate the comic prompt
  let thread
  let threadId
  if (memeThread != null) {
    threadId = memeThread
  } else {
    thread = await openai.beta.threads.create({});
    threadId = thread.id;
  }

  await openai.beta.threads.messages.create(threadId, {
    role: 'user',
    content: gptPrompt
  });

  // Polling the thread for completion
  const run = await runThread(threadId);

  // Step 3: Extract the generated prompt from the assistant's response
  if (run.status === 'completed') {
    const messages = await openai.beta.threads.messages.list(threadId);

    const assistantMessage = messages.data.filter(msg => msg.role === 'assistant')[0];
    let generatedPrompt = assistantMessage.content[0].text.value;
    generatedPrompt = removeHamTip(generatedPrompt)
    console.log('Generated comic prompt:', generatedPrompt);

    // Step 4: Generate the image based on the GPT-generated prompt
    const imageUrl = await generateImage("a hilarious meme about the following: " + generatedPrompt);
    console.log('Image url generated:', imageUrl);

    return imageUrl;
  } else {
    console.error('Error: Assistant run did not complete successfully.');
    return null;
  }
}

module.exports = { castDailySummary, castTrendingSummary, castDailyMeme };