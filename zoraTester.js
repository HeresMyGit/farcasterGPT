const { createContractAndToken, createTokenOnExistingContract } = require('./zora.js');

// Function to create a new ERC-1155 contract and token with specified metadata
async function addTokenToExistingContract() {
  // Define contract metadata
  const tokenName = "test token2";
  const tokenUriImageUrl = "https://heads.mfers.dev/4.png";   // Sample token image URL

  console.log("Creating new contract with metadata:");
  console.log("Contract Name:", tokenName);
  console.log("Token URI Image URL:", tokenUriImageUrl);

  try {
    const result = await createContractAndToken(tokenName, tokenUriImageUrl);
    if (result) {
      console.log("New ERC-1155 Contract Created Successfully:", result);
    } else {
      console.error("Failed to create contract. Check your metadata and network configuration.");
    }
  } catch (error) {
    console.error("Error creating contract and token:", error);
  }
}

// Run the example functions
addTokenToExistingContract();