const { createToken, createTokenOnExistingContract } = require('./zora.js');

// Function to create a new ERC-1155 contract and token with specified metadata
async function addTokenToExistingContract() {
  // Define contract metadata
  const tokenName = "based";
  const tokenUriImageUrl = "https://heads.mfers.dev/102.png";   // Sample token image URL
  const description = "based"

  console.log("Creating new contract with metadata:");
  console.log("Contract Name:", tokenName);
  console.log("Token URI Image URL:", tokenUriImageUrl);

  try {
    const result = await createToken(tokenUriImageUrl, tokenName, description, "test");
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