const { createCreatorClient } = require("@zoralabs/protocol-sdk");
const { createPublicClient, http } = require("viem");
const { ethers, Interface, MaxUint256 } = require("ethers");
const axios = require("axios");
const FormData = require("form-data");
require("dotenv").config();

const privateKey = process.env.PRIVATE_KEY;
const infuraProjectId = process.env.INFURA_PROJECT_ID;
const infuraProjectSecret = process.env.INFURA_PROJECT_SECRET;
const creatorAddress = "0xc1c8f153E18B93A3A1ec3CBd0e3F9b38159d2644";

const zoraContractAddress = "0x339563f98180dda919b9efc56f4f74c2e0b68dd0";
const fixedPriceSaleStrategyAddress = "0x6d28164C3CE04A190D5F9f0f8881fc807EAD975A";

const zoraSepolia = {
  id: 999999999,
  name: "Zora Sepolia",
  nativeCurrency: { decimals: 18, name: "SepoliaETH", symbol: "ETH" },
  rpcUrls: { default: { http: ['https://sepolia.rpc.zora.energy'] } },
};

const publicClient = createPublicClient({
  chain: zoraSepolia,
  transport: http(),
});

const provider = new ethers.JsonRpcProvider('https://sepolia.rpc.zora.energy');
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
    throw new Error("Failed to upload data to IPFS");
  }
}

async function createContractAndToken(tokenName, tokenUriImageUrl) {
  if (!tokenUriImageUrl) {
    throw new Error("Token image URL is undefined.");
  }

  try {
    const tokenMetadataUri = await uploadToIPFS({
      name: tokenName,
      image: await uploadImageToIPFS(tokenUriImageUrl),
      attributes: [
        { trait_type: "Trait 1", value: "Value 1" },
        { trait_type: "Trait 2", value: "Value 2" }
      ]
    });

    const factoryInterface = new Interface([
      "function setupNewTokenWithCreateReferral(string newURI, uint256 maxSupply, address createReferral) returns (uint256)",
      "event SetupNewToken(uint256 indexed tokenId, address indexed creator, string newURI, uint256 maxSupply)"
    ]);

    const encodedData = factoryInterface.encodeFunctionData("setupNewTokenWithCreateReferral", [
      tokenMetadataUri, MaxUint256, creatorAddress
    ]);

    const tx2 = await wallet.sendTransaction({
      to: zoraContractAddress,
      data: encodedData,
      gasLimit: 5000000,
    });

    const receipt = await tx2.wait();
    console.log("Token created successfully, transaction receipt:", receipt);

    if (!receipt || !receipt.logs || receipt.logs.length === 0) {
      console.error("Error: No logs found in the transaction receipt. Receipt:", receipt);
      throw new Error("Failed to retrieve tokenId from transaction receipt events.");
    }

    const setupNewTokenEvent = receipt.logs.find(log => log.topics[0] === ethers.id("SetupNewToken(uint256,address,string,uint256)"));

    if (!setupNewTokenEvent) {
      console.error("Error: SetupNewToken event not found in transaction logs. Logs:", receipt.logs);
      throw new Error("Failed to retrieve tokenId from transaction logs.");
    }

    const decodedEvent = factoryInterface.decodeEventLog("SetupNewToken", setupNewTokenEvent.data, setupNewTokenEvent.topics);
    const tokenId = decodedEvent.tokenId;

    console.log("Retrieved tokenId:", tokenId);

    await startFreeNeverEndingSale(tokenId);

    return { contractAddress: zoraContractAddress, tokenUri: tokenMetadataUri };
  } catch (error) {
    console.error("Error creating contract and token:", error);
    throw error;
  }
}

async function startFreeNeverEndingSale(tokenId) {
  const saleStrategyInterface = new ethers.Interface([
    "function setSale(uint256 tokenId, (uint64 saleStart, uint64 saleEnd, uint64 maxTokensPerAddress, uint96 pricePerToken, address fundsRecipient) salesConfig)",
    "function callSale(uint256 tokenId, address salesConfig, bytes data)"
  ]);

  const salesConfig = {
    saleStart: Math.floor(Date.now() / 1000), // Current time
    saleEnd: 4102444800, // Future date (January 1, 2100)
    maxTokensPerAddress: 0, // No limit per address
    pricePerToken: ethers.parseUnits("0", "ether"), // Free (0 ETH)
    fundsRecipient: creatorAddress // Recipient of funds (irrelevant since it’s free)
  };

  // Predefine `callSaleData` outside the try-catch block
  let callSaleData = '';

  const abiCoder = new ethers.AbiCoder();
  const encodedSalesConfig = abiCoder.encode(
    ["tuple(uint64 saleStart, uint64 saleEnd, uint64 maxTokensPerAddress, uint96 pricePerToken, address fundsRecipient)"],
    [salesConfig]
  );

  try {
    // First, set the sale configuration
    const setSaleData = saleStrategyInterface.encodeFunctionData("setSale", [
      tokenId,
      salesConfig
    ]);

    let tx = await wallet.sendTransaction({
      to: fixedPriceSaleStrategyAddress,
      data: setSaleData,
      gasLimit: 300000,
    });

    await tx.wait();
    console.log("Sale configuration set for token:", tokenId);

    // Now, construct `callSaleData` for the `callSale` function
    callSaleData = saleStrategyInterface.encodeFunctionData("callSale", [
      tokenId,
      fixedPriceSaleStrategyAddress,
      encodedSalesConfig
    ]);

    console.log("Constructed callSaleData:", callSaleData);

    tx = await wallet.sendTransaction({
      to: fixedPriceSaleStrategyAddress,
      data: callSaleData,
      gasLimit: 300000,
    });

    await tx.wait();
    console.log("Free, never-ending sale started for token:", tokenId);
  } catch (error) {
    console.error("Error starting free, never-ending sale:", error);
    console.log("Transaction Data:", {
      to: fixedPriceSaleStrategyAddress,
      data: callSaleData, // `callSaleData` should now be defined here
      salesConfig: encodedSalesConfig,
      tokenId,
    });
    throw error;
  }
}

async function uploadImageToIPFS(imageUrl) {
  if (!imageUrl) {
    throw new Error("Image URL is undefined or empty.");
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
    throw new Error("Failed to upload image to IPFS");
  }
}

module.exports = {
  createContractAndToken,
};