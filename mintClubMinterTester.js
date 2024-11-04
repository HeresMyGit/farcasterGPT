const { createAndMintNFT } = require('./mintClubMinter.js'); // Assuming mintClubMinter.js has the required functions

// Function to create a new ERC-1155 contract and token with specified metadata
async function createNewContractAndToken() {
  // Define contract metadata
  const contractName = "test contract3";
  const symbol = "teeeet";
  const description = "a test description"
  const contractUriImageUrl = "https://heads.mfers.dev/7447.png"; // Sample contract image URL

  console.log("Creating new contract with metadata:");
  console.log("Contract Name:", contractName);
  console.log("Symbol:", symbol);
  console.log("Description:", description);
  console.log("Contract URI Image URL:", contractUriImageUrl);

  try {
    const result = await createAndMintNFT(contractName, symbol, contractUriImageUrl, description);
    if (result) {
      console.log("New ERC-1155 Contract Created Successfully:", result);
    } else {
      console.error("Failed to create contract. Check your metadata and network configuration.");
    }
  } catch (error) {
    console.error("Error creating contract and token:", error);
  }
}


createNewContractAndToken();