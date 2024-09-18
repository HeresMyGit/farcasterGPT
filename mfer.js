const fetch = require('node-fetch');

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

module.exports = {
  getMferDescription
};