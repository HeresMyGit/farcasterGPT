const { openai } = require('./client');
const farcaster = require('./farcaster');
const ham = require('./ham');
const { getMferDescription } = require('./mfer.js');
const { generateImage } = require('./image.js');
const { interpretUrl } = require('./attachments.js');
const { createToken } = require('./zora.js')
const mintclub = require('./mintClub');
const degen = require('./degen');
const personalPrompt = require('./personalPrompt');
const { getXMTPConversationInfo } = require('./assistant');
const { getConversationAnalytics } = require('./xmtpUtils');
const xmtpContext = require('./xmtpContext');
const axios = require('axios');
const FormData = require('form-data');

// Key-value map for storing image URLs by run ID
const imageUrlMap = {};

// Function to handle required actions from the run
async function handleRequiresAction(run, threadId) {
  // Check if there are tools that require outputs

  if (
    run.required_action &&
    run.required_action.submit_tool_outputs &&
    run.required_action.submit_tool_outputs.tool_calls
  ) {
    // Prepare outputs for each required tool call
    const toolOutputs = await Promise.all(
      run.required_action.submit_tool_outputs.tool_calls.map(async (tool) => {
        if (tool.function.name === "fetch_user_profile") {
          // Extract the username parameter and fetch the user profile
          const { username, shouldFetchLatestCasts = false, shouldFetchPopularCasts = false } = JSON.parse(tool.function.arguments);
          const relevantUserProfiles = farcaster.loadAndFilterRelevantUserProfiles([username]);

          // Check if we have the relevant profile loaded; if not, generate on the fly
          console.warn(`Generating profile on the fly for ${username}...`);
          let userProfile = await farcaster.buildProfileOnTheFly(username, shouldFetchLatestCasts, shouldFetchPopularCasts);
          console.log(`Generated profile on the fly for ${username}.`);
          return {
            tool_call_id: tool.id,
            output: JSON.stringify(userProfile), // Format the fetched profile data
          };
        } else if (tool.function.name === "fetch_channel_details") {
          // Extract the query and shouldFetchTrendingCasts parameters
          const { query, shouldFetchTrendingCasts = false } = JSON.parse(tool.function.arguments);

          // Generate channel details on the fly with the shouldFetchTrendingCasts parameter
          console.warn(`Generating channel details on the fly for query: ${query}, shouldFetchTrendingCasts: ${shouldFetchTrendingCasts}...`);
          const channelDetails = await farcaster.buildChannelDetailsOnTheFly(query, shouldFetchTrendingCasts);
          console.log(`Generated channel details on the fly for query: ${query}.`);

          return {
            tool_call_id: tool.id,
            output: JSON.stringify(channelDetails), // Format the fetched channel details
          };
        } else if (tool.function.name === "fetch_ham_details") {
          // Extract the FID parameter and fetch the HAM info
          const { FID } = JSON.parse(tool.function.arguments);

          // Generate HAM info on the fly
          console.warn(`Fetching HAM info on the fly for FID: ${FID}...`);
          const hamInfo = await ham.getUserHamInfo(FID);
          console.log(`Fetched HAM info on the fly for FID: ${FID}.`);

          return {
            tool_call_id: tool.id,
            output: JSON.stringify(hamInfo), // Format the fetched HAM info
          };
        } else if (tool.function.name === "fetch_ham_leaderboard") {
          // Extract the page parameter, defaulting to 1 if not provided
          const { page = 1 } = JSON.parse(tool.function.arguments);

          // Fetch Ham scores on the fly
          console.warn(`Fetching Ham scores for page: ${page}...`);
          const hamScores = await ham.getHamScores(page);
          console.log(`Fetched Ham scores for page: ${page}.`);

          return {
            tool_call_id: tool.id,
            output: JSON.stringify(hamScores), // Format the fetched Ham scores
          };
        } else if (tool.function.name === "fetch_thread_details") {
          // Extract the cast and type parameters
          const { cast, type } = JSON.parse(tool.function.arguments);

          // Fetch Farcaster thread on the fly
          console.warn(`Fetching Farcaster thread messages for cast identifier: ${cast} with type: ${type}...`);
          const threadData = await farcaster.fetchFarcasterThread(cast, type);
          console.log(`Fetched Farcaster thread messages for cast identifier: ${cast} with type: ${type}.`);

          return {
            tool_call_id: tool.id,
            output: JSON.stringify(threadData), // Format the fetched thread data
          };
        } else if (tool.function.name === "fetch_floaty_leaderboard") {
          // Extract the tokenAddress and page parameters
          const { tokenAddress, page } = JSON.parse(tool.function.arguments);

          // Handle default value for page if it's not provided
          const pageNumber = page || 1;

          // Fetch Floaty leaderboard for the given tokenAddress
          console.warn(`Fetching Floaty leaderboard for token address: ${tokenAddress}, page: ${pageNumber}`);
          const leaderboard = await ham.getFloatyLeaderboard(tokenAddress, pageNumber);
          console.warn(`Fetched Floaty leaderboard for token address: ${tokenAddress}, page: ${pageNumber}`);

          return {
            tool_call_id: tool.id,
            output: JSON.stringify(leaderboard) // Return the leaderboard
          };
        } else if (tool.function.name === "fetch_floaties_leaderboard") {
          // Fetch Floaties leaderboard for all supported coins
          console.warn(`Fetching Floaties leaderboard for all coins...`);
          const leaderboard = await ham.getFloatiesLeaderboard();
          console.warn(`Fetched Floaties leaderboard for all coins...`);

          return {
            tool_call_id: tool.id,
            output: JSON.stringify(leaderboard) // Return the leaderboard
          };
        } else if (tool.function.name === "fetch_floaty_receivers_leaderboard") {
          // Extract the tokenAddress and page parameters
          const { tokenAddress, page } = JSON.parse(tool.function.arguments);

          // Handle default value for page if it's not provided
          const pageNumber = page || 1;

          // Fetch Floaty receivers leaderboard for the given tokenAddress
          console.warn(`Fetching Floaty receivers leaderboard for token address: ${tokenAddress}, page: ${pageNumber}`);
          const leaderboard = await ham.getFloatyReceiversLeaderboard(tokenAddress, pageNumber);
          console.warn(`Fetched Floaty receivers leaderboard for token address: ${tokenAddress}, page: ${pageNumber}`);

          return {
            tool_call_id: tool.id,
            output: JSON.stringify(leaderboard) // Return the receivers leaderboard
          };
        } else if (tool.function.name === "fetch_floaty_balances") {
          // Extract the address and fid parameters
          const { address, fid } = JSON.parse(tool.function.arguments);

          let balances;

          try {
            // Ensure that either address or fid is provided, but not both
            if (address && fid) {
              throw new Error("Provide either 'address' or 'fid', but not both.");
            } else if (address) {
              // Fetch balances by Ethereum address if provided
              console.warn(`Fetching Floaty balances for Ethereum address: ${address}`);
              balances = await ham.getFloatyBalancesByAddress(address);
              console.warn(`Fetched Floaty balances for Ethereum address: ${address}`);
            } else if (fid) {
              // Fetch balances by FID if provided
              console.warn(`Fetching Floaty balances for FID: ${fid}`);
              balances = await ham.getFloatyBalancesByFID(fid);
              console.warn(`Fetched Floaty balances for FID: ${fid}`);
            } else {
              // If neither is provided, throw an error
              throw new Error("Either 'address' or 'fid' must be provided.");
            }

            // Return the balances if fetched successfully
            return {
              tool_call_id: tool.id,
              output: JSON.stringify(balances) // Return the fetched balances
            };

          } catch (error) {
            console.error(`Error fetching Floaty balances: ${error.message}`);
            
            // Return an error message in case of failure
            return {
              tool_call_id: tool.id,
              output: JSON.stringify({ error: error.message })
            };
          }
        } else if (tool.function.name === "fetch_mfer_description") {
          // Extract the mferID parameter
          const { mferID } = JSON.parse(tool.function.arguments);

          // Validate the mferID
          if (mferID < 0 || mferID > 10020) {
            return {
              tool_call_id: tool.id,
              output: JSON.stringify({ error: "Invalid mfer ID provided. Must be between 0 and 10020." })
            };
          }

          // Fetch the mfer description and generate the image
          console.warn(`Fetching mfer description and generating image for ID: ${mferID}...`);
          const mferData = await getMferDescription(mferID);

          // Return the description and image
          return {
            tool_call_id: tool.id,
            output: JSON.stringify(mferData) // Return the mfer data, including traits and image
          };
        } else if (tool.function.name === "generate_image") {
          // Extract the prompt parameter
          const { prompt } = JSON.parse(tool.function.arguments);

          // Validate that the prompt is a non-empty string
          if (!prompt || typeof prompt !== "string") {
            return {
              tool_call_id: tool.id,
              output: JSON.stringify({ error: "Invalid prompt provided. Please provide a valid string." })
            };
          }

          // Call the image generation function (shell implementation for now)
          console.warn(`Generating image based on prompt: ${prompt}...`);
          const imageUrl = await generateImage(prompt); // Placeholder for actual image generation logic
          console.warn(`Generated image based on prompt: ${prompt}...`);

          // Store the image url in some map for later retrieval (use threadId/runId as key)
          imageUrlMap[run.id] = imageUrl;

          return {
            tool_call_id: tool.id,
            output: JSON.stringify(imageUrl) 
          };
        } else if (tool.function.name === "search_casts" || tool.function.name === "search_casts_by_author") {
            // Extract the parameters from the API call
            const { q, author_fid, viewer_fid, parent_url, channel_id, limit, cursor, api_key } = JSON.parse(tool.function.arguments);

            // Validate that the required parameter 'q' is provided
            if (!q || typeof q !== 'string') {
              return {
                tool_call_id: tool.id,
                output: JSON.stringify({ error: "Query parameter 'q' is required and must be a string." })
              };
            }

            // Fetch the casts using the fetchCasts function
            const castData = await farcaster.fetchCasts({
              q,
              author_fid,
              viewer_fid,
              parent_url,
              channel_id,
              limit,
              cursor,
              api_key
            });

            // Return the fetched data
            return {
              tool_call_id: tool.id,
              output: JSON.stringify(castData)
            };
        } else if (tool.function.name === "fetch_url_details") {
            const { url, prompt } = JSON.parse(tool.function.arguments);
            console.warn(`Fetching description for URL: ${url}, with prompt: ${prompt || 'none'}...`);
            
            // Assuming there's a function fetchUrlDescription that handles URL interpretation
            const description = await interpretUrl(url, prompt);
            console.log(`Fetched description for URL: ${url}.`);

            return {
              tool_call_id: tool.id,
              output: JSON.stringify({ description }), // Returning the description as JSON
            };
        } else if (tool.function.name === 'fetch_trending_casts') {
          const { channelId, limit, timeWindow } = JSON.parse(tool.function.arguments);
          console.log(`Fetching trending casts for channelId: ${channelId}, limit: ${limit || 5}, timeWindow: ${timeWindow || '7d'}`);
          
          const result = await farcaster.getTrendingCasts(channelId, limit || 5, timeWindow || '7d');
          
          return {
            tool_call_id: tool.id,
            output: JSON.stringify(result)
          };
        } else if (tool.function.name === 'fetch_degen_airdrop_points') {
          const { season, wallet } = JSON.parse(tool.function.arguments);
          console.log(`Fetching airdrop points for season: ${season}, wallet: ${wallet}`);
          const result = await degen.fetchAirdropPoints(season, wallet);
          return {
            tool_call_id: tool.id,
            output: JSON.stringify(result)
          };
        } else if (tool.function.name === 'fetch_degen_airdrop_allowances') {
          const { wallet, fid } = JSON.parse(tool.function.arguments);
          console.log(`Fetching airdrop allowances for wallet: ${wallet}, FID: ${fid}`);
          const result = await degen.fetchAirdropAllowances({ wallet, fid });
          return {
            tool_call_id: tool.id,
            output: JSON.stringify(result)
          };
        } else if (tool.function.name === 'fetch_degen_airdrop_tips') {
          const { fid, limit, offset } = JSON.parse(tool.function.arguments);
          console.log(`Fetching airdrop tips for FID: ${fid}, limit: ${limit}, offset: ${offset}`);
          const result = await degen.fetchAirdropTips(fid, limit, offset);
          return {
            tool_call_id: tool.id,
            output: JSON.stringify(result)
          };
        } else if (tool.function.name === "fetch_mintclub_token_details") {
          // Extract tokenContractId and network parameters
          const { tokenContractId, network = "base" } = JSON.parse(tool.function.arguments);

          // Convert tokenContractId to uppercase
          const formattedTokenContractId = tokenContractId?.toLowerCase() === "sartoshi" ? "$SARTOSHI" : tokenContractId?.toUpperCase();
          const upperCaseTokenContractId = formattedTokenContractId?.toUpperCase();

          if (!upperCaseTokenContractId) {
            return {
              tool_call_id: tool.id,
              output: JSON.stringify({ error: "Token contract ID is required" })
            };
          }

          console.log(`Fetching token details for contract ID: ${upperCaseTokenContractId} on network: ${network}`);
          const { token } = mintclub.initializeContracts(null, upperCaseTokenContractId, network); // Initialize with specified network

          const tokenDetails = await mintclub.getTokenDetails(token);

          return {
            tool_call_id: tool.id,
            output: JSON.stringify(tokenDetails) // Return formatted token details
          };
        } else if (tool.function.name === "mint_artwork") {
          // Extract parameters
          const { tokenUriImageUrl, tokenName, description, artist, userWalletAddress, mferID, extraTraits } = JSON.parse(tool.function.arguments);

          // Validate that all required parameters are provided
          if (!tokenUriImageUrl || !tokenName || !description || !artist || !userWalletAddress) {
            return {
              tool_call_id: tool.id,
              output: JSON.stringify({ error: "All required parameters (tokenUriImageUrl, tokenName, description, artist, userWalletAddress) are required." })
            };
          }

          console.log(`Minting artwork with image URL: ${tokenUriImageUrl}, name: ${tokenName}, description: ${description}, artist: ${artist}, user wallet: ${userWalletAddress}`);

          // Log mferID and extraTraits if available
          if (mferID) {
            console.log(`mferID: ${mferID}`);
          }

          if (extraTraits) {
            console.log(`extraTraits: ${JSON.stringify(extraTraits)}`);
          }

          try {
            // Call the createToken function, passing mferID and extraTraits if available
            const result = await createToken(tokenUriImageUrl, tokenName, description, artist, userWalletAddress, mferID, extraTraits);

            // Return the result
            return {
              tool_call_id: tool.id,
              output: JSON.stringify(result)
            };
          } catch (error) {
            console.error(`Error minting artwork: ${error.message}`);

            // Return error
            return {
              tool_call_id: tool.id,
              output: JSON.stringify({ error: error.message })
            };
          }
        } else if (tool.function.name === 'fetch_mint_club_token_balance') {
          const { wallet, ticker } = JSON.parse(tool.function.arguments);
          console.log(`Fetching Mint Club token balance for wallet: ${wallet}, Ticker: ${ticker}`);

          console.log(`Fetching token details for contract ID: ${ticker} on network: Base`);
          const { token } = mintclub.initializeContracts(ticker, "base"); // Initialize with specified network
          
          const result = await mintclub.getTokenBalance(token, wallet);
          
          return {
            tool_call_id: tool.id,
            output: JSON.stringify(result)
          };
        } else if (tool.function.name === 'getXMTPConversationInfo') {
          console.log(`Fetching XMTP conversation info...`);
          const { conversationId } = JSON.parse(tool.function.arguments);
          
          try {
            // Check if we have XMTP context available
            if (xmtpContext.hasContext()) {
              const { client, conversation } = xmtpContext.getContext();
              
              // Get conversation analytics directly
              const analytics = await getConversationAnalytics(conversation, client);
              
              if (analytics) {
                const result = {
                  success: true,
                  conversationInfo: {
                    id: analytics.info.conversationId.substring(0, 8) + '...',
                    type: analytics.info.conversationType,
                    created: new Date(analytics.info.createdAt).toLocaleDateString(),
                    messageCount: analytics.info.messageCount,
                    isActive: analytics.info.isActive,
                    participants: {
                      you: analytics.participants.self.inboxId.substring(0, 8) + '...',
                      peer: analytics.participants.peer.inboxId.substring(0, 8) + '...',
                      peerDevices: analytics.participants.peer.installations
                    },
                    activity: {
                      conversationAge: analytics.status.conversationAge + ' days',
                      lastActivity: analytics.status.lastActivity ? new Date(analytics.status.lastActivity).toLocaleString() : 'unknown',
                      hoursSinceLastActivity: analytics.status.hoursSinceLastActivity + 'h ago'
                    }
                  }
                };
                
                return {
                  tool_call_id: tool.id,
                  output: JSON.stringify(result),
                };
              }
            }
            
            // Fallback if no context
            const result = {
              success: false,
              error: "XMTP context not available. This function works best within XMTP conversations.",
              hint: "Try asking about conversation details again, or use '/info' command.",
              conversationId: conversationId
            };
            
            return {
              tool_call_id: tool.id,
              output: JSON.stringify(result),
            };
          } catch (error) {
            console.error('Error with XMTP conversation info:', error);
            return {
              tool_call_id: tool.id,
              output: JSON.stringify({ success: false, error: error.message }),
            };
          }
        } else {
          console.warn(`No handler for tool: ${tool.function.name}`);
          return {
            tool_call_id: tool.id,
            output: JSON.stringify({ error: `No function for ${tool.function.name}` })
          };
        }
        // Add other function handlers if necessary
      })
    );

    // Submit the tool outputs to the assistant
    if (toolOutputs.length > 0) {
      run = await openai.beta.threads.runs.submitToolOutputsAndPoll(
        threadId,
        run.id,
        { tool_outputs: toolOutputs.filter(Boolean) } // Filter out any undefined results
      );
      console.log("Tool outputs submitted successfully.");
    } else {
      console.log("No tool outputs to submit.");
    }

    // Check run status after submitting tool outputs
    return run;
  }

  // Return the run as is if no actions were required
  return run;
}

module.exports = {
  handleRequiresAction,
  imageUrlMap,
};