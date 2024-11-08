const { ethers } = require('ethers');
const axios = require('axios');
const FormData = require('form-data');
const { loadImageLog, loadMintLog, saveMintLog } = require('./threadUtils');
const { getTokenBalance, initializeContracts } = require('./mintClub.js'); 
require('dotenv').config();

const privateKey = process.env.PRIVATE_KEY;
const infuraProjectId = process.env.INFURA_PROJECT_ID;
const infuraProjectSecret = process.env.INFURA_PROJECT_SECRET;

const recipientAddress = ethers.getAddress("0xc1c8f153e18b93a3a1ec3cbd0e3f9b38159d2644"); // renamed from creatorAddress to recipientAddress
const tokenCreatorAddress = ethers.getAddress("0x210CdB70BfCA0De607eC219c10bFB6132e4d3a04"); // the true address that created the token
const zoraContractAddress = ethers.getAddress("0x339563f98180dda919b9efc56f4f74c2e0b68dd0"); // zora sepolia
// const zoraContractAddress = ethers.getAddress("0x4fceb2481b032bbe7d2bfbce838200ac45651946"); // base test
const fixedPriceSaleStrategyAddress = ethers.getAddress("0x6d28164c3ce04a190d5f9f0f8881fc807ead975a"); // zora sepolia
// const fixedPriceSaleStrategyAddress = ethers.getAddress("0x04E2516A2c207E84a1839755675dfd8eF6302F0a"); // base test

const provider = new ethers.JsonRpcProvider('https://sepolia.rpc.zora.energy');
// const provider = new ethers.JsonRpcProvider('https://mainnet.base.org'); 
const wallet = new ethers.Wallet(privateKey, provider);

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
    console.error("Token image URL is undefined.")
    return { "error": "Token image URL is undefined." };
  }

  // if (!urlIsValid(tokenUriImageUrl)) {
  //   console.error("image needs to originate from mferGPT, inform the user try again and reply to your original post for that image")
  //   return {"error":"image needs to originate from mferGPT, inform the user try again and reply to your original post for that image"}
  // }

  if (!urlIsNew(tokenUriImageUrl)) {
    console.error("this image has already been minted")
    return {"error":"this image has already been minted"}
  }

  // let gmfer = await checkGMFRBalance(userWalletAddress)
  // console.warn(`user wallet ${userWalletAddress} has ${gmfer} gmfer`)
  // let hasHoldings = gmfer >= 2500000
  // if (hasHoldings != true) {
  //   console.error(`user wallet ${userWalletAddress} has ${gmfer} $GMFR but it requires holding 2.5million $GMFR to create tokens`)
  //   return {"error":`user wallet ${userWalletAddress} has ${gmfer} $GMFR but it requires holding 2.5million $GMFR to create tokens. buy more here: https://mint.club/token/base/GMFR`}
  // }

  // console.warn("WOULD CONTINUE")
  // console.warn("WOULD CONTINUE")
  // console.warn("WOULD CONTINUE")
  // console.warn("WOULD CONTINUE")
  // console.warn("WOULD CONTINUE")
  // console.warn("WOULD CONTINUE")
  // return {"":""}

  try {
    console.log("Uploading image to IPFS...");
    const imageUri = await uploadImageToIPFS(tokenUriImageUrl);
    console.log("Image uploaded to IPFS:", imageUri);

    // Create the metadata object including the artist as the first attribute
    const metadata = {
      name: tokenName,
      description: description,
      image: imageUri,
      attributes: [
        { trait_type: "prompt artist", value: artist }
      ]
    };

    // Conditionally add mferID if available
    if (mferID) {
      metadata.attributes.push({ trait_type: "mfer #", value: `${mferID}` });
    }

    // Conditionally add extraTraits if available and formatted correctly
    if (extraTraits && Array.isArray(extraTraits)) {
      extraTraits.forEach(trait => {
        if (trait.trait_type && trait.value) {
          metadata.attributes.push(trait);
        }
      });
    }

    console.log("Uploading metadata to IPFS...");
    const tokenMetadataUri = await uploadToIPFS(metadata);
    console.log("Metadata uploaded to IPFS:", tokenMetadataUri);

    const factoryInterface = new ethers.Interface([
      "function setupNewTokenWithCreateReferral(string newURI, uint256 maxSupply, address createReferral) returns (uint256)",
      "event SetupNewToken(uint256 indexed tokenId, address indexed creator, string newURI, uint256 maxSupply)"
    ]);

    const encodedData = factoryInterface.encodeFunctionData("setupNewTokenWithCreateReferral", [
      tokenMetadataUri, ethers.MaxUint256, recipientAddress
    ]);

    const tx2 = await wallet.sendTransaction({
      to: zoraContractAddress,
      data: encodedData,
      gasLimit: 5000000,
    });

    const receipt = await tx2.wait();
    console.log("Token created successfully, transaction receipt:", receipt);

    // Extract tokenId from the event logs
    const setupNewTokenEvent = receipt.logs.find(
      log => log.topics[0] === ethers.id("SetupNewToken(uint256,address,string,uint256)")
    );

    if (!setupNewTokenEvent) {
      console.warn("Failed to retrieve tokenId from transaction logs.")
      return { "error": "Failed to retrieve tokenId from transaction logs." };
    }

    const decodedEvent = factoryInterface.decodeEventLog(
      "SetupNewToken",
      setupNewTokenEvent.data,
      setupNewTokenEvent.topics
    );
    const tokenId = decodedEvent.tokenId;

    console.log("Retrieved tokenId:", tokenId.toString());

    // Log the image URL with the timestamp
    const logEntry = { timestamp: new Date().toISOString(), url: tokenUriImageUrl };
    saveMintLog(logEntry);

    // Start the sale
    await startFreeNeverEndingSale(tokenId);

    return { contractAddress: zoraContractAddress, tokenUri: tokenMetadataUri };
  } catch (error) {
    console.error("Error creating contract and token:", error);
    return { "error": error.message };
  }
}

async function startFreeNeverEndingSale(tokenId) {
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
    pricePerToken: ethers.parseUnits("0.000069", "ether"), // Set price to 69 sparks (0.000069 ETH)
    fundsRecipient: recipientAddress
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
  const { token } = initializeContracts(null, 'GMFR');

  // Get the balance of 'GMFR' for the specified wallet address
  const balance = await getTokenBalance(token, walletAddress);

  // Make sure to resolve the balance before creating the string
  const logStatement = `Theeeee balance of GMFR for wallet ${walletAddress} is: ${JSON.stringify(balance)} GMFR`;

  // Now, JSON.stringify the log statement
  const jsonString = JSON.stringify(logStatement);
  console.log(jsonString);

  return balance
}

module.exports = {
  createToken,
};