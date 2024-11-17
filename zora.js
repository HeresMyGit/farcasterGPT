const { ethers } = require('ethers');
const axios = require('axios');
const FormData = require('form-data');
const { loadImageLog, loadMintLog, saveMintLog, loadUserMints, saveUserMint, lastMintForUser  } = require('./threadUtils');
const { getTokenBalance, initializeContracts } = require('./mintClub.js'); 
const { SplitsClient } = require('@0xsplits/splits-sdk');
const { createPublicClient, createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
require('dotenv').config();

const privateKey = process.env.PRIVATE_KEY;
const infuraProjectId = process.env.INFURA_PROJECT_ID;
const infuraProjectSecret = process.env.INFURA_PROJECT_SECRET;
const splitsApiKey = process.env.SPLITS_API_KEY; 


const ENVIRONMENTS = {
    zoraSepolia: {
        recipientAddress: "0x210CdB70BfCA0De607eC219c10bFB6132e4d3a04",
        tokenCreatorAddress: "0x210CdB70BfCA0De607eC219c10bFB6132e4d3a04",
        zoraContractAddress: "0x339563f98180dda919b9efc56f4f74c2e0b68dd0",
        fixedPriceSaleStrategyAddress: "0x6d28164c3ce04a190d5f9f0f8881fc807ead975a",
        rpcProvider: "https://sepolia.rpc.zora.energy",
        chainId: 999999999,
    },
    baseTest: {
        recipientAddress: "0x2119ff364fbF1Ae11688f781104caADa673D0194",
        tokenCreatorAddress: "0x3b54621FE962ee8E5283f2429B800e2E212c9a02",
        zoraContractAddress: "0x4fceb2481b032bbe7d2bfbce838200ac45651946",
        fixedPriceSaleStrategyAddress: "0x04E2516A2c207E84a1839755675dfd8eF6302F0a",
        rpcProvider: "https://base-goerli.blockpi.network/v1/rpc/public",
        chainId: 8453
    },
    baseProd: {
        recipientAddress: "0x2119ff364fbF1Ae11688f781104caADa673D0194",
        tokenCreatorAddress: "0x3b54621FE962ee8E5283f2429B800e2E212c9a02",
        zoraContractAddress: "0xe2559ded6fdec98e68b40d7c382c502949c975fb",
        fixedPriceSaleStrategyAddress: "0x04E2516A2c207E84a1839755675dfd8eF6302F0a",
        rpcProvider: "https://mainnet.base.org",
        chainId: 8453
    },
    sepolia: {
        recipientAddress: "0x210CdB70BfCA0De607eC219c10bFB6132e4d3a04", // Same as zoraSepolia
        tokenCreatorAddress: "0x210CdB70BfCA0De607eC219c10bFB6132e4d3a04",
        zoraContractAddress: "0x339563f98180dda919b9efc56f4f74c2e0b68dd0",
        fixedPriceSaleStrategyAddress: "0x6d28164c3ce04a190d5f9f0f8881fc807ead975a",
        rpcProvider: `https://sepolia.infura.io/v3/${infuraProjectId}`, // Updated RPC provider
        chainId: 11155111, // Standard Sepolia chain ID
    },
};

// Set the environment: 'zoraSepolia', 'baseTest', or 'baseProd'
// const selectedEnvironment = 'baseProd';
// const selectedEnvironment = 'baseTest';
const selectedEnvironment = 'zoraSepolia';

// Load configuration
const { recipientAddress, tokenCreatorAddress, zoraContractAddress, fixedPriceSaleStrategyAddress, rpcProvider, chainId } =
    ENVIRONMENTS[selectedEnvironment];

// Convert to ethers addresses
const recipientAddressEthers = ethers.getAddress(recipientAddress);
const tokenCreatorAddressEthers = ethers.getAddress(tokenCreatorAddress);
const zoraContractAddressEthers = ethers.getAddress(zoraContractAddress);
const fixedPriceSaleStrategyAddressEthers = ethers.getAddress(fixedPriceSaleStrategyAddress);

const ONE_WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;

// Setup provider and wallet
const provider = new ethers.JsonRpcProvider(rpcProvider);
const wallet = new ethers.Wallet(privateKey, provider);

// Logging to ensure values are correct
console.log("Using environment:", selectedEnvironment);
console.log("Recipient Address:", recipientAddressEthers);
console.log("Token Creator Address:", tokenCreatorAddressEthers);
console.log("Zora Contract Address:", zoraContractAddressEthers);
console.log("Fixed Price Sale Strategy Address:", fixedPriceSaleStrategyAddressEthers);
console.log("RPC Provider:", rpcProvider);

// Define the chain configuration for viem
const customChain = {
    id: chainId,
    name: selectedEnvironment,
    network: selectedEnvironment,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
        default: { http: [rpcProvider] },
        public: { http: [rpcProvider] },
    },
    blockExplorers: {
        default: { name: 'Etherscan', url: 'https://sepolia.etherscan.io' }, // Update URL if necessary
    },
    testnet: selectedEnvironment !== 'baseProd',
};

// Create the viem public client
const publicClient = createPublicClient({
    chain: customChain,
    transport: http(),
});

// Create the account using privateKeyToAccount by prepending '0x' to the private key
const account = privateKeyToAccount(`0x${privateKey}`);

// Create the viem wallet client
const walletClient = createWalletClient({
    account,
    chain: customChain,
    transport: http(),
});

// Initialize the SplitsClient
const splitsClient = new SplitsClient({
    chainId: customChain.id,
    publicClient,
    walletClient,
    includeEnsNames: false,
    apiConfig: {
        apiKey: splitsApiKey, // Ensure your API key is set in the .env file
    },
}).splitV1;

async function uploadToIPFS(data) {
  try {
    const formData = new FormData();
    formData.append("file", Buffer.from(JSON.stringify(data)), { filename: "metadata.json" });

    const ipfsResponse = await axios.post(
      `https://ipfs.infura.io:5001/api/v0/add`,
      formData,
      {
        headers: { ...formData.getHeaders() },
        auth: { username: infuraProjectId, password: infuraProjectSecret },
      }
    );

    return `ipfs://${ipfsResponse.data.Hash}`;
  } catch (error) {
    console.error("Error uploading to IPFS:", error);
    return { "error": "Failed to upload data to IPFS" };
  }
}

async function createToken(tokenUriImageUrl, tokenName, description, artist, userWalletAddress, mferID, extraTraits) {
    if (!tokenUriImageUrl) {
        console.error("Token image URL is undefined.");
        return { "error": "Token image URL is undefined." };
    }

    if (!urlIsValid(tokenUriImageUrl)) {
        console.error("Image needs to originate from mferGPT. Inform the user to try again and reply to the original post for that image.");
        return { "error": "Image needs to originate from mferGPT. Please use the original image URL or respond to the post where mferGPT generated the image." };
    }

    if (!urlIsNew(tokenUriImageUrl)) {
        console.error("This image has already been minted.");
        return { "error": "This image has already been minted." };
    }

    // Check if the user is eligible to mint
    const mintCheck = await canMint(userWalletAddress);
    if (!mintCheck.eligible) {
        console.error(mintCheck.message);
        return { "error": mintCheck.message };
    }

    try {
        console.log("Uploading image to IPFS...");
        const imageUri = await uploadImageToIPFS(tokenUriImageUrl);
        console.log("Image uploaded to IPFS:", imageUri);

        // Prepare metadata
        const metadata = {
            name: tokenName,
            description: description,
            image: imageUri,
            attributes: [
                { trait_type: "prompt artist", value: artist },
                ...(mferID ? [{ trait_type: "mfer #", value: `${mferID}` }] : []),
                ...(extraTraits || []).filter(trait => trait.trait_type && trait.value),
            ],
        };

        console.log("Uploading metadata to IPFS...");
        const tokenMetadataUri = await uploadToIPFS(metadata);
        console.log("Metadata uploaded to IPFS:", tokenMetadataUri);

        // Predict and create the split if necessary
        const splitAddress = await createSplitAndPredictAddress(userWalletAddress, recipientAddress);
        if (!splitAddress) {
            return { "error": "Failed to create or retrieve split address." };
        }

        console.log("Creating token...");
        const factoryInterface = new ethers.Interface([
            "function setupNewTokenWithCreateReferral(string newURI, uint256 maxSupply, address createReferral) returns (uint256)",
            "event SetupNewToken(uint256 indexed tokenId, address indexed creator, string newURI, uint256 maxSupply)",
        ]);

        const maxSupply = 69;
        const encodedData = factoryInterface.encodeFunctionData("setupNewTokenWithCreateReferral", [
            tokenMetadataUri,
            maxSupply,
            recipientAddress,
        ]);

        const tx = await wallet.sendTransaction({
            to: zoraContractAddress,
            data: encodedData,
            gasLimit: 5000000,
        });

        const receipt = await tx.wait();
        console.log("Token created successfully, transaction receipt:", receipt);

        // Extract tokenId from logs
        const setupNewTokenEvent = receipt.logs.find(
            log => log.topics[0] === ethers.id("SetupNewToken(uint256,address,string,uint256)")
        );

        if (!setupNewTokenEvent) {
            console.warn("Failed to retrieve tokenId from transaction logs.");
            return { "error": "Failed to retrieve tokenId from transaction logs." };
        }

        const decodedEvent = factoryInterface.decodeEventLog(
            "SetupNewToken",
            setupNewTokenEvent.data,
            setupNewTokenEvent.topics,
        );
        const tokenId = decodedEvent.tokenId;

        console.log("Retrieved tokenId:", tokenId.toString());

        // Start sale with split address as fundsRecipient
        await startFreeNeverEndingSale(tokenId, splitAddress);

        return { link: `https://zora.co/collect/base:${zoraContractAddress}/${tokenId}` };
    } catch (error) {
        console.error("Error creating contract and token:", error);
        return { "error": error.message };
    }
}

async function createSplitAndPredictAddress(userWalletAddress, recipientAddress) {
    try {
        const splitsConfig = {
            recipients: [
                {
                    address: userWalletAddress,
                    percentAllocation: 52.0,
                },
                {
                    address: recipientAddress,
                    percentAllocation: 48.0,
                },
            ],
            distributorFeePercent: 0.0,
        };

        // Predict the split address
        const predicted = await splitsClient.predictImmutableSplitAddress(splitsConfig);

        console.log("Predicted split address:", predicted.splitAddress);
        if (!predicted.splitExists) {
            console.log("Split does not exist, creating it...");

            const { data, address } = await splitsClient.callData.createSplit(splitsConfig);

            // Send transaction to create the split
            const tx = await walletClient.sendTransaction({
                to: address,
                account,
                data,
            });
            await publicClient.waitForTransactionReceipt({ hash: tx });
            console.log("Split created successfully:", predicted.splitAddress);
        } else {
            console.log(`Split already exists: ${predicted.splitAddress}`);
        }

        return predicted.splitAddress;
    } catch (error) {
        console.error("Error predicting or creating split address:", error);
        return null;
    }
}


async function startFreeNeverEndingSale(tokenId, fundsRecipientAddress) {
  const creatorContractABI = [
    "function callSale(uint256 tokenId, address saleStrategy, bytes data) external",
    "function addPermission(uint256 tokenId, address user, uint256 permissionBits) external"
  ];

  const creatorContract = new ethers.Contract(
    zoraContractAddress,
    creatorContractABI,
    wallet
  );

  const salesConfig = {
    saleStart: BigInt(Math.floor(Date.now() / 1000)),
    saleEnd: BigInt(4102444800),
    maxTokensPerAddress: BigInt(0), // Unlimited tokens per address
    pricePerToken: ethers.parseUnits("0.000420", "ether"), // Set price to 69 sparks (0.000069 ETH)
    fundsRecipient: fundsRecipientAddress
  };

  // Log the salesConfig parameters
  console.log("Sales Configuration Parameters:");
  console.log("saleStart:", salesConfig.saleStart.toString());
  console.log("saleEnd:", salesConfig.saleEnd.toString());
  console.log("maxTokensPerAddress:", salesConfig.maxTokensPerAddress.toString());
  console.log("pricePerToken (in wei):", salesConfig.pricePerToken.toString());
  console.log("fundsRecipient:", salesConfig.fundsRecipient);

  const saleStrategyInterface = new ethers.Interface([
    "function setSale(uint256 tokenId, (uint64 saleStart, uint64 saleEnd, uint64 maxTokensPerAddress, uint96 pricePerToken, address fundsRecipient) salesConfig)"
  ]);

  const encodedData = saleStrategyInterface.encodeFunctionData("setSale", [
    tokenId,
    [
      salesConfig.saleStart,
      salesConfig.saleEnd,
      salesConfig.maxTokensPerAddress,
      salesConfig.pricePerToken,
      salesConfig.fundsRecipient,
    ]
  ]);

  try {
    const PERMISSION_BIT_SALES = BigInt(8);
    const PERMISSION_BIT_MINTER = BigInt(4);

    // Add permission to your wallet address for sales
    console.log("Attempting to add sales permission for tokenId:", tokenId.toString());
    const tx1 = await creatorContract["addPermission(uint256,address,uint256)"](
      tokenId,
      wallet.address,
      PERMISSION_BIT_SALES
    );
    console.log("Waiting for sales permission transaction to be mined...");
    await tx1.wait();
    console.log("Sales permission added successfully");

    // Grant MINTER permission to the sales strategy contract
    console.log("Granting MINTER permission to the sales strategy contract...");
    const tx2 = await creatorContract["addPermission(uint256,address,uint256)"](
      tokenId,
      fixedPriceSaleStrategyAddress,
      PERMISSION_BIT_MINTER
    );
    console.log("Waiting for MINTER permission transaction to be mined...");
    await tx2.wait();
    console.log("MINTER permission granted successfully");

    // Fetch current gas prices
    const feeData = await provider.getFeeData();
    console.log("Fee data retrieved:", feeData);

    // Set a reasonable gas limit
    const gasLimit = 5000000;
    console.log("Gas limit set to:", gasLimit);

    // Log transaction options before sending
    const txOptions = {
      gasLimit: gasLimit,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
    };
    console.log("Transaction options:", txOptions);

    // Send the actual transaction
    console.log("Attempting to call callSale with tokenId:", tokenId.toString());
    console.log("Using sale strategy address:", fixedPriceSaleStrategyAddress);
    console.log("With encoded data:", encodedData);

    const tx3 = await creatorContract.callSale(
      tokenId,
      fixedPriceSaleStrategyAddress,
      encodedData,
      txOptions
    );

    console.log("Transaction sent, awaiting confirmation...");
    await tx3.wait();
    console.log("Sale with price 69 sparks started for token:", tokenId.toString());
  } catch (error) {
    console.error("Error starting sale:", error);
    return { "error": error.message };
  }
}

async function airdropToken(tokenId, recipientAddress) {
  try {
    const creatorContractABI = [
      "function adminMint(address recipient, uint256 tokenId, uint256 quantity, bytes data) external"
    ];

    const creatorContract = new ethers.Contract(
      zoraContractAddress,
      creatorContractABI,
      wallet
    );

    console.log(`Airdropping token ID ${tokenId} to ${recipientAddress}...`);

    // Call adminMint with a quantity of 1 and empty data
    const tx = await creatorContract.adminMint(recipientAddress, tokenId, 1, "0x");
    console.log("Transaction sent, awaiting confirmation...");
    await tx.wait();

    console.log(`Token ID ${tokenId} successfully airdropped to ${recipientAddress}`);
  } catch (error) {
    console.error("Error airdropping token:", error);
    throw new Error("Airdrop failed: " + error.message);
  }
}

async function uploadImageToIPFS(imageUrl) {
  if (!imageUrl) {
    console.warn("Image URL is undefined or empty.");
    return { "error": "Image URL is undefined or empty." };
  }

  try {
    console.log("Uploading to IPFS:", imageUrl);
    const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const imageBuffer = Buffer.from(imageResponse.data, "binary");
    const formData = new FormData();
    formData.append("file", imageBuffer, { filename: "image.png" });

    const ipfsResponse = await axios.post(
      `https://ipfs.infura.io:5001/api/v0/add`,
      formData,
      {
        headers: { ...formData.getHeaders() },
        auth: { username: infuraProjectId, password: infuraProjectSecret },
      }
    );

    console.log("Uploaded to IPFS with hash:", ipfsResponse.data.Hash);
    return `ipfs://${ipfsResponse.data.Hash}`;
  } catch (error) {
    console.error("Error uploading to IPFS:", error);
    return { "error": "Failed to upload image to IPFS" };
  }
}


// Check if a URL is valid (i.e., exists in the log)
function urlIsValid(url) {
  const imageLog = loadImageLog();
  return imageLog.some(entry => entry.url === url);
}

// Check if a URL is new (i.e., not already minted)
function urlIsNew(url) {
  const mintLog = loadMintLog();
  const old = mintLog.some(entry => entry.url === url);
  return !old
}

async function checkGMFRBalance(walletAddress) {
  // Initialize the token contract with the token ID 'GMFR'
  const { token } = initializeContracts('GMFR');

  // Get the balance of 'GMFR' for the specified wallet address
  const balance = await getTokenBalance(token, walletAddress);

  // Make sure to resolve the balance before creating the string
  const logStatement = `Theeeee balance of GMFR for wallet ${walletAddress} is: ${JSON.stringify(balance)} GMFR`;

  // Now, JSON.stringify the log statement
  const jsonString = JSON.stringify(logStatement);
  console.log(jsonString);

  return balance
}

async function checkMIGVIDBalance(walletAddress) {
  // Initialize the token contract with the token ID 'GMFR'
  const { nft } = initializeContracts('MIGVID');

  // Get the balance of 'GMFR' for the specified wallet address
  const balance = await getTokenBalance(nft, walletAddress);

  // Make sure to resolve the balance before creating the string
  const logStatement = `Theeeee balance of MIGVID for wallet ${walletAddress} is: ${JSON.stringify(balance)} MIGVID`;

  // Now, JSON.stringify the log statement
  const jsonString = JSON.stringify(logStatement);
  console.log(jsonString);

  return balance
}

async function canMint(userWalletAddress) {
  const now = new Date();
  const lastMintDate = lastMintForUser(userWalletAddress);

  // Check GMFR balance
  const gmferBalance = await checkGMFRBalance(userWalletAddress);

  // If the user holds at least 2.5 million GMFR, they can mint without restrictions
  if (gmferBalance >= 2500000) {
    return { eligible: true, message: "User holds sufficient GMFR to mint." };
  }

   // Check GMFR balance
  // const migvidBalance = await checkMIGVIDBalance(userWalletAddress);

  // // If the user holds at least 2.5 million GMFR, they can mint without restrictions
  // if (migvidBalance >= 1) {
  //   return { eligible: true, message: "User holds sufficient MIGVID to mint." };
  // }

  // Check if the user minted in the last week
  if (lastMintDate) {
    const lastMintTimestamp = new Date(lastMintDate).getTime();
    const timeSinceLastMint = now.getTime() - lastMintTimestamp;

    if (timeSinceLastMint < ONE_WEEK_IN_MS) {
      const daysRemaining = Math.ceil((ONE_WEEK_IN_MS - timeSinceLastMint) / (24 * 60 * 60 * 1000));
      return { eligible: false, message: `You minted less than a week ago. Please wait ${daysRemaining} more days.` };
    }
  }

  // If no restrictions apply, the user can mint
  return { eligible: true, message: "User is eligible to mint." };
}

module.exports = {
  createToken,
};