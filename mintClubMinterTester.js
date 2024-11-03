const { createAndMintNFT } = require('./mintClubMinter.js'); // Assuming mintClubMinter.js has the required functions

// Function to create a new ERC-1155 contract and token with specified metadata
async function createNewContractAndToken() {
  // Define contract metadata
  const contractName = "test contract1";
  const contractUriImageUrl = "https://heads.mfers.dev/7444.png"; // Sample contract image URL

  console.log("Creating new contract with metadata:");
  console.log("Contract Name:", contractName);
  console.log("Contract URI Image URL:", contractUriImageUrl);

  try {
    const result = await createAndMintNFT(contractName, contractUriImageUrl);
    if (result) {
      console.log("New ERC-1155 Contract Created Successfully:", result);
    } else {
      console.error("Failed to create contract. Check your metadata and network configuration.");
    }
  } catch (error) {
    console.error("Error creating contract and token:", error);
  }
}

// Function to add a token to an existing ERC-1155 contract
async function addTokenToExistingContract() {
  // Define existing contract address and token metadata
  const contractAddress = '0xExistingContractAddressHere'; // Replace with the actual contract address
  const tokenUriImageUrl = "https://example.com/path/to/new-token-image.png"; // Replace with the actual image URL

  console.log("Adding token to existing contract:");
  console.log("Contract Address:", contractAddress);
  console.log("Token URI Image URL:", tokenUriImageUrl);

  try {
    // Assuming createTokenOnExistingContract is implemented in mintClubMinter.js or another module
    const result = await createTokenOnExistingContract(contractAddress, tokenUriImageUrl);
    if (result) {
      console.log("Token Added to Existing Contract Successfully:", result);
    } else {
      console.error("Failed to add token. Verify contract address and token metadata.");
    }
  } catch (error) {
    console.error("Error adding token to existing contract:", error);
  }
}

// Run the example functions
createNewContractAndToken();
// Uncomment the line below to test adding a token to an existing contract after configuring the address
// addTokenToExistingContract();