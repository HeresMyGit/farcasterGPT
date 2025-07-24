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
const { getConversationAnalytics, lookupFarcasterUsernames, replaceKnownAddresses } = require('./xmtpUtils');
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
          
          // Retry logic for context availability
          const maxRetries = 3;
          let attempt = 0;
          
          while (attempt < maxRetries) {
            try {
              attempt++;
              console.log(`🔍 Checking XMTP context availability (attempt ${attempt}/${maxRetries})...`);
              
              // Check if we have XMTP context available
              if (xmtpContext.hasContext()) {
              console.log(`✅ XMTP context is available for conversation summary`);
              const contextInfo = xmtpContext.getContext();
              console.log(`🔗 Context details: conversationId=${contextInfo.conversationId?.slice(0, 8)}...`);
              const { client, conversation } = xmtpContext.getContext();
              
              // Get conversation analytics directly
              const analytics = await getConversationAnalytics(conversation, client);
              
              if (analytics) {
                const result = {
                  success: true,
                  conversationInfo: {
                    id: analytics.info.conversationId ? 
                        analytics.info.conversationId.substring(0, 8) + '...' : 'unknown',
                    type: analytics.info.conversationType,
                    created: new Date(analytics.info.createdAt).toLocaleDateString(),
                    messageCount: analytics.info.messageCount,
                    isActive: analytics.info.isActive,
                    participants: {
                      you: analytics.participants.self.inboxId ? 
                           analytics.participants.self.inboxId.substring(0, 8) + '...' : 'unknown',
                      peer: analytics.participants.peer.inboxId ? 
                            analytics.participants.peer.inboxId.substring(0, 8) + '...' : 'unknown',
                      peerDevices: analytics.participants.peer.installations
                    },
                    activity: {
                      conversationAge: analytics.status.conversationAge !== null ? 
                                      analytics.status.conversationAge + ' days' : 'unknown',
                      lastActivity: analytics.status.lastActivity ? 
                                   new Date(analytics.status.lastActivity).toLocaleString() : 'unknown',
                      hoursSinceLastActivity: analytics.status.hoursSinceLastActivity !== undefined ? 
                                             analytics.status.hoursSinceLastActivity + 'h ago' : 'unknown'
                    }
                  }
                };
                
                return {
                  tool_call_id: tool.id,
                  output: JSON.stringify(result),
                };
              }
            } else {
              // No context available, check if we should retry
              if (attempt < maxRetries) {
                console.log(`❌ XMTP context not available on attempt ${attempt}. Retrying in 2 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue; // Retry
              } else {
                // Max retries reached
                console.log(`❌ XMTP context is NOT available after ${maxRetries} attempts`);
                console.log(`🔍 Context check details: hasContext=${xmtpContext.hasContext()}`);
                const result = {
                  success: false,
                  error: `XMTP context not available after ${maxRetries} attempts. This function works best within XMTP conversations.`,
                  hint: "Try asking about conversation details again, or use '/info' command.",
                  conversationId: conversationId,
                  attempts: maxRetries
                };
                
                return {
                  tool_call_id: tool.id,
                  output: JSON.stringify(result),
                };
              }
            }
            
          } catch (error) {
            console.error(`❌ Error with XMTP conversation info (attempt ${attempt}):`, error.message);
            
            // If we have retries left, wait and try again
            if (attempt < maxRetries) {
              console.log(`⏳ Waiting 2 seconds before retry ${attempt + 1}...`);
              await new Promise(resolve => setTimeout(resolve, 2000));
              continue; // Retry
            } else {
              // Max retries reached
              return {
                tool_call_id: tool.id,
                output: JSON.stringify({ success: false, error: `Failed after ${maxRetries} attempts: ${error.message}` }),
              };
            }
          }
          } // End of retry while loop
        } else if (tool.function.name === 'look_up_xmtp_user_by_address') {
          console.log(`Looking up XMTP user by wallet address...`);
          
          try {
            const { walletAddress } = JSON.parse(tool.function.arguments);
            
            if (!walletAddress) {
              throw new Error('Wallet address is required');
            }
            
            console.log(`🔍 Looking up user for address: ${walletAddress}`);
            
            // Use our existing lookup function
            const usernames = await lookupFarcasterUsernames([walletAddress]);
            const normalizedAddress = walletAddress.toLowerCase();
            const username = usernames[normalizedAddress];
            
            const result = {
              success: true,
              walletAddress: walletAddress,
              farcasterUsername: username || null,
              displayName: username ? `@${username}` : null,
              found: !!username,
              lookupMethod: username ? 'neynar_bulk_api' : 'not_found'
            };
            
            if (username) {
              console.log(`✅ Found user: ${walletAddress} → @${username}`);
            } else {
              console.log(`❌ No Farcaster username found for: ${walletAddress}`);
            }
            
            return {
              tool_call_id: tool.id,
              output: JSON.stringify(result),
            };
          } catch (error) {
            console.error('Error looking up XMTP user by address:', error);
            return {
              tool_call_id: tool.id,
              output: JSON.stringify({ 
                success: false, 
                error: error.message,
                walletAddress: tool.function.arguments ? JSON.parse(tool.function.arguments).walletAddress : 'unknown'
              }),
            };
          }
        } else if (tool.function.name === 'get_conversation_summary') {
          console.log(`Generating conversation summary...`);
          const { conversationId, maxMessages = 100 } = JSON.parse(tool.function.arguments);
          
          // Retry logic for context availability
          const maxRetries = 3;
          let attempt = 0;
          let lastError = null;
          
          while (attempt < maxRetries) {
            try {
              attempt++;
              console.log(`🔍 Attempting conversation summary (attempt ${attempt}/${maxRetries})...`);
              
              // Check if we have XMTP context available
              if (!xmtpContext.hasContext()) {
                throw new Error("XMTP context not available. This function works within XMTP conversations only.");
              }
              
              console.log(`✅ XMTP context is available - proceeding with summary...`);
            
            const { client, conversation } = xmtpContext.getContext();
            
            // Get the conversation by ID to ensure we have the right one
            const convo = await client.conversations.getConversationById(conversationId);
            if (!convo) {
              throw new Error(`Conversation ${conversationId} not found`);
            }
            
            // Get recent messages (note: XMTP returns messages in reverse chronological order)
            console.log(`Fetching ${maxMessages} recent messages for summary...`);
            const messages = await convo.messages(maxMessages);
            
            if (!messages || messages.length === 0) {
              const emptyMsg = "No messages found in this conversation to summarize.";
              const processedEmptyMsg = replaceKnownAddresses(emptyMsg);
              await convo.send(processedEmptyMsg);
              return {
                tool_call_id: tool.id,
                output: JSON.stringify({ summary: emptyMsg })
              };
            }
            
            // Extract unique sender inbox IDs and resolve to usernames
            const uniqueSenderIds = [...new Set(messages.map(m => m.senderInboxId))];
            console.log(`Resolving ${uniqueSenderIds.length} unique participants for summary...`);
            
            // Resolve inbox IDs to wallet addresses
            const senderMapping = {};
            
            try {
              // Get inbox states for all unique senders
              const inboxStates = await client.preferences.inboxStateFromInboxIds(uniqueSenderIds);
              
              // Extract wallet addresses
              const walletAddresses = [];
              const inboxToWallet = {};
              
              inboxStates.forEach((state, index) => {
                const inboxId = uniqueSenderIds[index];
                const walletAddr = state?.identifiers?.[0]?.identifier;
                if (walletAddr) {
                  walletAddresses.push(walletAddr);
                  inboxToWallet[inboxId] = walletAddr;
                }
              });
              
              // Look up Farcaster usernames for wallet addresses
              if (walletAddresses.length > 0) {
                console.log(`Looking up Farcaster usernames for ${walletAddresses.length} wallet addresses...`);
                const usernames = await lookupFarcasterUsernames(walletAddresses);
                
                // Create final mapping: inbox ID → display name
                uniqueSenderIds.forEach(inboxId => {
                  const walletAddr = inboxToWallet[inboxId];
                  if (walletAddr) {
                    const username = usernames[walletAddr.toLowerCase()];
                    senderMapping[inboxId] = username ? `@${username}` : `${walletAddr.slice(0, 6)}...${walletAddr.slice(-4)}`;
                  } else {
                    senderMapping[inboxId] = `${inboxId.slice(0, 6)}`;
                  }
                });
              } else {
                // Fallback: use truncated inbox IDs
                uniqueSenderIds.forEach(inboxId => {
                  senderMapping[inboxId] = `${inboxId.slice(0, 6)}`;
                });
              }
              
              console.log(`Resolved participants:`, Object.entries(senderMapping).map(([id, name]) => `${id.slice(0, 6)}...→${name}`));
              
            } catch (resolutionError) {
              console.warn('Error resolving participants, using fallback names:', resolutionError.message);
              // Fallback: use truncated inbox IDs
              uniqueSenderIds.forEach(inboxId => {
                senderMapping[inboxId] = `${inboxId.slice(0, 6)}`;
              });
            }
            
            // Format messages for summarization (newest first, so reverse to get chronological order)
            const history = messages
              .reverse() // Convert to oldest → newest
              .map((m) => `${senderMapping[m.senderInboxId] || m.senderInboxId.slice(0, 6)}: ${m.content}`)
              .join('\n');
            
            console.log(`Creating summary from ${messages.length} messages with resolved participants...`);
            
            // Use Assistants API to generate summary (avoiding circular dependency)
            console.log(`🧵 Creating new thread for conversation summary...`);
            
            // Create a new thread for the summary
            const summaryThread = await openai.beta.threads.create({});
            const summaryThreadId = summaryThread.id;
            console.log(`Created summary thread: ${summaryThreadId}`);
            
            // Create the summary request message with detailed instructions
            const summaryMessageObject = {
              instructions: [
                "Create an extremely detailed and comprehensive summary of this XMTP chat conversation.",
                "Be very specific and include as much relevant detail as possible.",
                "This summary should serve as a complete record that someone could read to fully understand what happened.",
                "Use the detailed formatting requirements provided in the conversation history below."
              ],
              task: "conversation_summary",
              data: {
                conversationId: conversationId,
                messageCount: messages.length,
                participantCount: Object.keys(senderMapping).length,
                platform: "XMTP",
                timestamp: new Date().toISOString()
              },
              conversation_history: history,
              summary_requirements: "Create an extremely detailed and comprehensive summary of this chat conversation. Be very specific and include as much relevant detail as possible. Your summary should include:\n\nREQUIRED DETAILS:\n- Participants: List each person and their role/contributions\n- Timeline: Chronological flow of the conversation with key moments\n- Topics Discussed: Every major and minor topic, with specific details\n- Decisions Made: Any conclusions, agreements, or plans established\n- Questions Asked: Both questions posed and answers given\n- Action Items: Any tasks, follow-ups, or commitments mentioned\n- Links/References: Any URLs, mentions, or external references shared\n- Sentiment/Tone: Overall mood and how it evolved\n- Context: Background information that explains the discussion\n\nFORMATTING:\n- Use clear section headers with bullet points\n- Include specific quotes when they're important\n- Mention exact numbers, dates, times when discussed\n- Reference specific tools, platforms, or technical details mentioned\n- Note any inside jokes, slang, or community-specific references\n\nSTYLE:\n- Keep usernames concise but be extremely detailed about content\n- Don't summarize - include the actual substance of what was discussed\n- If someone explained how something works, include those details\n- If plans were made, include the specifics\n- Capture the personality and voice of the conversation\n\nBe thorough - this summary should serve as a complete record that someone could read to fully understand what happened in this conversation."
            };
            
            const summaryMessage = JSON.stringify(summaryMessageObject, null, 2);
            
            // Add message to the summary thread
            console.log(`📝 Adding conversation history to summary thread...`);
            await openai.beta.threads.messages.create(summaryThreadId, {
              role: 'user',
              content: summaryMessage,
            });
            
            // Use a summary-specific assistant (no functions to avoid recursion)
            const summaryAssistantModel = process.env.SUMMARY_MODEL || process.env.XMTP_MODEL || process.env.ASST_MODEL;
            console.log(`🤖 Running summary with assistant model: ${summaryAssistantModel}`);
            
            let summaryRun = await openai.beta.threads.runs.createAndPoll(summaryThreadId, {
              assistant_id: summaryAssistantModel,
              model: process.env.MODEL,
            });
            
            // No function handling needed for summary-only assistant
            // If it somehow still requires action, that's an error
            if (summaryRun.status === 'requires_action') {
              console.error(`⚠️ Summary assistant tried to call functions - this should not happen!`);
              throw new Error(`Summary assistant attempted function calls - check SUMMARY_MODEL configuration`);
            }
            
            if (!summaryRun || summaryRun.status !== 'completed') {
              throw new Error(`Summary generation failed with status: ${summaryRun?.status || 'unknown'}`);
            }
            
            // Extract the summary from the assistant's response
            const summaryMessages = await openai.beta.threads.messages.list(summaryRun.thread_id);
            
            if (!summaryMessages || !summaryMessages.data || summaryMessages.data.length === 0) {
              throw new Error('No summary response generated');
            }
            
            const assistantMessages = summaryMessages.data.filter(msg => msg.role === 'assistant');
            if (assistantMessages.length === 0) {
              throw new Error('No assistant summary found');
            }
            
            const summary = assistantMessages[0].content[0].text.value;
            
            console.log(`✅ Generated detailed conversation summary from ${messages.length} messages using Assistants API`);

            // Return the summary to fulfill the tool call - let the assistant handle sending it
            return {
              tool_call_id: tool.id,
              output: summary  // Return summary directly, not as JSON
            };
            
          } catch (error) {
            lastError = error;
            console.error(`❌ Attempt ${attempt} failed:`, error.message);
            
            // If it's a context error and we have retries left, wait and try again
            if (error.message.includes("XMTP context not available") && attempt < maxRetries) {
              console.log(`⏳ Waiting 2 seconds before retry ${attempt + 1}...`);
              await new Promise(resolve => setTimeout(resolve, 2000));
              continue; // Retry
            } else {
              // For other errors or max retries reached, break out
              break;
            }
          }
          } // End of retry while loop
          
          // If we get here, all retries failed
          console.error(`💥 All ${maxRetries} attempts failed. Last error:`, lastError?.message);
          return {
            tool_call_id: tool.id,
            output: JSON.stringify({ 
              success: false, 
              error: `Failed after ${maxRetries} attempts: ${lastError?.message}`,
              attempts: maxRetries 
            }),
          };
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