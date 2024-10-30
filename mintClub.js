const { mintclub } = require('mint.club-v2-sdk');

const DEFAULT_NETWORK = 'base';
const DEFAULT_DECIMALS = 18;

// Initialize NFT and Token contracts
function initializeContracts(nftContractId, tokenContractId, network = DEFAULT_NETWORK) {
  const baseNetwork = mintclub.network(network);
  const nft = nftContractId ? baseNetwork.nft(nftContractId) : null;
  const token = tokenContractId ? baseNetwork.token(tokenContractId) : null;

  return { nft, token };
}

// Fetch detailed token information and adjust for decimals and percentages
async function getTokenDetails(token) {
  if (!token) {
    console.error("Token contract not initialized.");
    return { error: "Token contract not initialized" };
  }

  try {
    console.log("Fetching detailed token information.");
    const details = await token.getDetail();

    // Extract decimals from the details
    const { decimals } = details.info;
    const adjustDecimals = (value) => Number(value) / Math.pow(10, decimals);

    // Format royalties as percentages
    const formatPercentage = (value) => `${value / 100}%`;

    // Adjusting necessary fields for decimal places and formatting royalties
    const adjustedDetails = {
      mintRoyalty: formatPercentage(details.mintRoyalty),
      burnRoyalty: formatPercentage(details.burnRoyalty),
      info: {
        ...details.info,
        currentSupply: adjustDecimals(details.info.currentSupply),
        maxSupply: adjustDecimals(details.info.maxSupply),
        priceForNextMint: adjustDecimals(details.info.priceForNextMint),
        reserveBalance: adjustDecimals(details.info.reserveBalance),
      },
    };

    // Remove the 'steps' property if it exists
    delete adjustedDetails.info.steps;

    console.log("Token Details (adjusted for decimals and percentages, without steps):", adjustedDetails);
    return adjustedDetails;
  } catch (error) {
    console.error("Error fetching token details:", error);
    return { error: "Error fetching token details" };
  }
}

// Buy NFT tokens
async function buyTokens(nft, amount) {
  if (!nft) {
    console.error("NFT contract not initialized.");
    return { error: "NFT contract not initialized" };
  }

  const buyParams = { amount: BigInt(amount) };
  try {
    console.log(`Buying NFT tokens with amount: ${amount}`);
    return await nft.buy(buyParams);
  } catch (error) {
    console.error("Error buying tokens:", error);
    return { error: "Error buying tokens" };
  }
}

// Sell NFT tokens
async function sellTokens(nft, amount) {
  if (!nft) {
    console.error("NFT contract not initialized.");
    return { error: "NFT contract not initialized" };
  }

  const sellParams = { amount: BigInt(amount) };
  try {
    console.log(`Selling NFT tokens with amount: ${amount}`);
    return await nft.sell(sellParams);
  } catch (error) {
    console.error("Error selling tokens:", error);
    return { error: "Error selling tokens" };
  }
}

// Create ERC-1155 NFT
async function createNFT(nft, metadataUrl, {
  reserveToken = { address: '0x4200000000000000000000000000000000000006', decimals: DEFAULT_DECIMALS },
  curveType = 'EXPONENTIAL',
  stepCount = 10,
  maxSupply = 10000,
  initialMintingPrice = 0.01,
  finalMintingPrice = 0.1,
  creatorAllocation = 100,
} = {}) {
  if (!nft) {
    console.error("NFT contract not initialized.");
    return { error: "NFT contract not initialized" };
  }

  try {
    console.log(`Creating NFT with metadata URL: ${metadataUrl}`);
    return await nft.create({
      reserveToken,
      curveData: { curveType, stepCount, maxSupply, initialMintingPrice, finalMintingPrice, creatorAllocation },
      metadataUrl,
    });
  } catch (error) {
    console.error("Error creating NFT:", error);
    return { error: "Error creating NFT" };
  }
}

// Create ERC-20 Token
async function createToken(token, {
  reserveToken = { address: '0x4200000000000000000000000000000000000006', decimals: DEFAULT_DECIMALS },
  curveType = 'EXPONENTIAL',
  stepCount = 10,
  maxSupply = 10000,
  initialMintingPrice = 0.01,
  finalMintingPrice = 0.1,
  creatorAllocation = 100,
} = {}) {
  if (!token) {
    console.error("Token contract not initialized.");
    return { error: "Token contract not initialized" };
  }

  try {
    console.log("Creating ERC-20 token.");
    return await token.create({
      reserveToken,
      curveData: { curveType, stepCount, maxSupply, initialMintingPrice, finalMintingPrice, creatorAllocation },
    });
  } catch (error) {
    console.error("Error creating token:", error);
    return { error: "Error creating token" };
  }
}

// Export functions for external use
module.exports = {
  initializeContracts,
  getTokenDetails,
  buyTokens,
  sellTokens,
  createNFT,
  createToken,
};

// const { token } = initializeContracts(null, 'GMFR'); // Replace 'GMFR' with your token contract ID if different
// const token = mintclub.network('base').token('$SARTOSHI');
// // Fetch and log the total supply without printing steps
// getTokenDetails(token).then((supply) => {
//   // Clone the supply object and remove the steps property for cleaner logging
  // const supplyWithoutSteps = { ...supply };
  // delete supplyWithoutSteps.steps;

//   console.log("Total Supply of MortyMee6 NFT at script end (without steps):", supplyWithoutSteps);
// }).catch((error) => {
//   console.error("Error in fetching total supply at script end:", error);
// });
