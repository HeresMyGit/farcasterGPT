const fetch = require('node-fetch');
const { ethers } = require('ethers');
const { resolveDisplayName } = require('./nameResolver.cjs');

// mfers NFT contract on Ethereum mainnet
const MFERS_CONTRACT_ADDRESS = '0x79FCDEF22feeD20eDDacbB2587640e45491b757f';
const MFERS_ABI = ['function ownerOf(uint256 tokenId) view returns (address)'];

// Fetch the mfer description and generate an image based on traits
async function getMferDescription(mferID) {
  const url = `https://gpt.mfers.dev/descriptions/${mferID}.json`;

  try {
    console.log(`Fetching mfer description for ID: ${mferID}...`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch mfer description for ID ${mferID}: ${response.statusText}`);
    }

    const data = await response.json(); // Parse the JSON response
    return data; // Return the mfer's traits and image

  } catch (error) {
    console.error(`Error fetching mfer description for ID ${mferID}:`, error.message);
    return { error: "Something went wrong" }; // Return an error message on failure
  }
}

// Get the owner of a specific mfer NFT on Ethereum mainnet
async function getMferOwner(mferID) {
  try {
    console.log(`Fetching owner of mfer #${mferID} on Ethereum mainnet...`);
    
    // Use a public Ethereum RPC endpoint
    const provider = new ethers.JsonRpcProvider('https://rpc.ankr.com/eth');
    const contract = new ethers.Contract(MFERS_CONTRACT_ADDRESS, MFERS_ABI, provider);
    
    const ownerAddress = await contract.ownerOf(mferID);
    console.log(`Owner of mfer #${mferID}: ${ownerAddress}`);
    
    return ownerAddress;
  } catch (error) {
    console.error(`Error fetching owner of mfer #${mferID}:`, error.message);
    return null;
  }
}

// Get owner info including ENS, Basename, or Farcaster username
async function getMferOwnerInfo(mferID) {
  try {
    const ownerAddress = await getMferOwner(mferID);
    
    if (!ownerAddress) {
      return { address: null, displayName: null };
    }
    
    // Try to resolve the address to a human-readable name
    console.log(`Resolving display name for ${ownerAddress}...`);
    const displayName = await resolveDisplayName(ownerAddress, 8000);
    
    console.log(`Resolved display name: ${displayName}`);
    
    return {
      address: ownerAddress,
      displayName: displayName,
      // Check if displayName is different from truncated address (meaning we found a real name)
      hasHumanReadableName: displayName && !displayName.includes('…') && displayName !== ownerAddress
    };
  } catch (error) {
    console.error(`Error getting owner info for mfer #${mferID}:`, error.message);
    return { address: null, displayName: null, hasHumanReadableName: false };
  }
}

module.exports = {
  getMferDescription,
  getMferOwner,
  getMferOwnerInfo
};