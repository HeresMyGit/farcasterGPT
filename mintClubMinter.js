const { ethers } = require('ethers');
const { mintclub } = require('mint.club-v2-sdk');
require('dotenv').config();

const privateKey = process.env.PRIVATE_KEY;
const infuraProjectId = process.env.INFURA_PROJECT_ID;
const filebaseApiKey = process.env.FILEBASE_API_KEY;

// Set up the provider using Infura for Sepolia network
const provider = new ethers.JsonRpcProvider(`https://sepolia.infura.io/v3/${infuraProjectId}`);
const wallet = new ethers.Wallet(privateKey, provider);

// Sepolia WETH contract address
const sepoliaWETH = {
  address: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9",
  decimals: 18,
};

// Bond contract ABI (simplified for createToken function)
const BOND_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: 'string', name: 'name', type: 'string' },
          { internalType: 'string', name: 'symbol', type: 'string' },
          { internalType: 'string', name: 'uri', type: 'string' },
        ],
        internalType: 'struct MCV2_Bond.TokenParams',
        name: 'tp',
        type: 'tuple',
      },
      {
        components: [
          { internalType: 'uint16', name: 'mintRoyalty', type: 'uint16' },
          { internalType: 'uint16', name: 'burnRoyalty', type: 'uint16' },
          { internalType: 'address', name: 'reserveToken', type: 'address' },
          { internalType: 'uint128', name: 'maxSupply', type: 'uint128' },
          { internalType: 'uint128[]', name: 'stepRanges', type: 'uint128[]' },
          { internalType: 'uint128[]', name: 'stepPrices', type: 'uint128[]' },
        ],
        internalType: 'struct MCV2_Bond.BondParams',
        name: 'bp',
        type: 'tuple',
      },
    ],
    name: 'createToken',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'payable',
    type: 'function',
  },
];

// Bond contract address on Sepolia
const bondContractAddress = "0x8dce343A86Aa950d539eeE0e166AFfd0Ef515C0c"; // Replace with actual contract address

// Instantiate the bond contract
const bondContract = new ethers.Contract(bondContractAddress, BOND_ABI, wallet);

async function uploadToIPFS(imageUrl) {
  if (!filebaseApiKey) {
    throw new Error("Filebase API key is missing. Please set FILEBASE_API_KEY in your environment variables.");
  }

  try {
    console.log("Uploading image to IPFS:", imageUrl);

    // Fetch the image and convert it to a blob
    const response = await fetch(imageUrl);
    const arrayBuffer = await response.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: 'image/png' });

    // Call mintclub.ipfs.add with blob and API key
    const ipfsHash = await mintclub.ipfs.add(filebaseApiKey, blob);
    const ipfsUrl = `ipfs://${ipfsHash}`;

    console.log("Uploaded to IPFS with URL:", ipfsUrl);
    return ipfsUrl;
  } catch (error) {
    console.error("Error uploading to IPFS:", error);
    throw new Error("Failed to upload image to IPFS");
  }
}

async function createNewToken(name, symbol, metadataUrl) {
  try {
    const tokenParams = {
      name,
      symbol,
      uri: metadataUrl,
    };

    const bondParams = {
      mintRoyalty: 100,
      burnRoyalty: 150,
      reserveToken: sepoliaWETH.address,
      maxSupply: 10000000, // Use regular integer value
      stepRanges: [10000, 100000, 200000, 500000, 1000000, 2000000, 5000000, 10000000], // Regular integers
      stepPrices: [0, 2, 3, 4, 5, 7, 10, 15], // Regular integers
    };

    console.log("Creating token with the following parameters:", tokenParams, bondParams);

    const tx = await bondContract.createToken(tokenParams, bondParams, {
      value: ethers.utils.parseEther("0.01"), // Adjust value if necessary
    });

    console.log("Transaction sent, waiting for confirmation...");
    const receipt = await tx.wait();
    console.log("Token created successfully, transaction receipt:", receipt);

    return receipt;
  } catch (error) {
    console.error("Error deploying NFT contract:", error);
    return undefined;
  }
}

// Main function to create and mint an ERC-1155 NFT
async function createAndMintNFT(contractName, contractUriImageUrl) {
  if (!contractUriImageUrl) throw new Error("Contract image URL is undefined.");

  try {
    const metadataUrl = await uploadToIPFS(contractUriImageUrl); // Upload metadata to IPFS
    const contractAddress = await createNewToken(contractName, "SYMBOL", metadataUrl); // Deploy contract with bonding curve

    if (contractAddress) {
      console.log("NFT contract created successfully on Sepolia:", contractAddress);
      return contractAddress;
    }
  } catch (error) {
    console.error("Error in NFT creation and minting process:", error);
  }
}

// Usage example
// createAndMintNFT('test contract1', 'https://heads.mfers.dev/7444.png');

module.exports = {
  createAndMintNFT,
};