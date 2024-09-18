const fetch = require('node-fetch');
const farcaster = require('./farcaster'); 

const BASE_URL = 'https://farcaster.dep.dev';

// Utility function to resolve FID, assuming FID is the username if it's invalid
async function resolveFID(FID) {
  // Check if FID is null, 0, or non-numerical
  if (!FID || isNaN(FID)) {
    console.warn(`Invalid FID provided (${FID}). Assuming it is a username.`);
    
    try {
      // Assume FID is actually a username and fetch the profile
      const userProfile = await farcaster.fetchUserProfile(FID); // FID used as the username here
      if (userProfile && userProfile.fid) {
        console.log(`Fetched FID ${userProfile.fid} for username ${FID}`);
        return userProfile.fid; // Return the resolved FID
      } else {
        console.error(`Unable to fetch FID for username: ${FID}`);
        return null;
      }
    } catch (error) {
      console.error(`Error fetching profile for username ${FID}:`, error);
      return null;
    }
  }
  return FID; // Return the original FID if it's valid
}

// Verify the status of a Ham tip or Floaty by cast or tweet ID
async function verifyTip(messageID) {
  const url = `${BASE_URL}/ham/verify-tip/${messageID}`;
  console.log(`Sending request to URL: ${url}`);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to verify tip: ${response.statusText}`);
    }
    const data = await response.json(); // Await the JSON parsing
    return adjustNumbers(data); // Return the resolved and adjusted data
  } catch (error) {
    console.error(`Error verifying tip for message ID ${messageID}:`, error);
    return { error: "something went wrong" }; // Return an error message on failure
  }
}

// Helper function to adjust numbers according to the given rules with logging
function adjustNumbers(obj) {
  for (const key in obj) {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      adjustNumbers(obj[key]); // Recursively adjust numbers in nested objects
    } else if (typeof obj[key] === 'number') {
      if (obj[key].toString().includes('.') && obj[key].toString().split('.')[1].length > 4) {
        // Log before and after shortening numbers to 4 decimal places
        console.log(`Adjusting ${key}: ${obj[key]} to 4 decimal places.`);
        obj[key] = parseFloat(obj[key].toFixed(4));
        console.log(`Adjusted ${key}: ${obj[key]}`);
      } else if (obj[key] >= 1e18) {
        // Log before and after dividing numbers with over 18 non-decimal places by 10^18
        console.log(`Adjusting ${key}: ${obj[key]} by dividing by 10^18 and shortening to 4 decimals.`);
        obj[key] = parseFloat((obj[key] / 1e18).toFixed(4));
        console.log(`Adjusted ${key}: ${obj[key]}`);
      }
    } else if (typeof obj[key] === 'string' && !isNaN(obj[key])) {
      const num = parseFloat(obj[key]);
      if (obj[key].includes('.') && obj[key].split('.')[1].length > 4) {
        // Log before and after shortening string numbers to 4 decimal places
        console.log(`Adjusting string ${key}: ${obj[key]} to 4 decimal places.`);
        obj[key] = parseFloat(num.toFixed(4));
        console.log(`Adjusted string ${key}: ${obj[key]}`);
      } else if (num >= 1e18) {
        // Log before and after dividing string numbers with over 18 non-decimal places by 10^18
        console.log(`Adjusting string ${key}: ${obj[key]} by dividing by 10^18 and shortening to 4 decimals.`);
        obj[key] = parseFloat((num / 1e18).toFixed(4)).toString(); // Convert back to string after adjustment
        console.log(`Adjusted string ${key}: ${obj[key]}`);
      }
    }
  }
  return obj;
}

// Get tip information for a given FID
async function getUserHamInfo(FID) {
  const resolvedFID = await resolveFID(FID);
  if (!resolvedFID) {
    return { error: "Invalid FID or username" }; // Handle cases where FID cannot be resolved
  }

  const url = `${BASE_URL}/ham/user/${resolvedFID}`;
  console.log(`Sending request to URL: ${url}`);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { error: "something went wrong" };
      throw new Error(`Failed to get user HAM info: ${response.statusText}`);
    }
    const data = await response.json(); // Await the JSON parsing
    return adjustNumbers(data); // Return the resolved and adjusted data
  } catch (error) {
    console.error(`Error fetching HAM info for FID ${resolvedFID}:`, error);
    return { error: "something went wrong" }; // Return an error message on failure
  }
}

// Returns the Ham list leaderboard in a paginated list format
async function getHamScores(page = 1) {
  const url = `${BASE_URL}/ham/ham-scores?page=${page}`;
  console.log(`Sending request to URL: ${url}`);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to get Ham scores: ${response.statusText}`);
    }
    const data = await response.json(); // Await the JSON parsing
    return adjustNumbers(data); // Return the resolved and adjusted data
  } catch (error) {
    console.error('Error fetching Ham scores:', error);
    return { error: "something went wrong" }; // Return an error message on failure
  }
}

// Get the leaderboard of Floaty senders for a given token
async function getFloatyLeaderboard(tokenAddress, page = 1) {
  const url = `${BASE_URL}/floaties/sent/leaderboard/${tokenAddress}?page=${page}`;
  console.log(`Sending request to URL: ${url}`);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to get Floaty leaderboard: ${response.statusText}`);
    }
    const data = await response.json(); // Await the JSON parsing
    return adjustNumbers(data); // Return the resolved and adjusted data
  } catch (error) {
    console.error(`Error fetching Floaty leaderboard for token address ${tokenAddress}:`, error);
    return { error: "something went wrong" }; // Return an error message on failure
  }
}

// Get how many Floaties have been tipped for all supported coins
async function getFloatiesLeaderboard() {
  const url = `${BASE_URL}/floaties/leaderboard`;
  console.log(`Sending request to URL: ${url}`);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to get Floaties leaderboard: ${response.statusText}`);
    }
    const data = await response.json(); // Await the JSON parsing
    return adjustNumbers(data); // Return the resolved and adjusted data
  } catch (error) {
    console.error('Error fetching Floaties leaderboard:', error);
    return { error: "something went wrong" }; // Return an error message on failure
  }
}

// Get leaderboard of users who have received floaties for a given coin
async function getFloatyReceiversLeaderboard(tokenAddress, page = 1) {
  const url = `${BASE_URL}/floaties/leaderboard/${tokenAddress}?page=${page}`;
  console.log(`Sending request to URL: ${url}`);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to get Floaty receivers leaderboard: ${response.statusText}`);
    }
    const data = await response.json(); // Await the JSON parsing
    return adjustNumbers(data); // Return the resolved and adjusted data
  } catch (error) {
    console.error(`Error fetching Floaty receivers leaderboard for token address ${tokenAddress}:`, error);
    return { error: "something went wrong" }; // Return an error message on failure
  }
}

// Retrieves all Floaty balances for a specified Ethereum address
async function getFloatyBalancesByAddress(address) {
  const url = `${BASE_URL}/floaties/balance/${address}`;
  console.log(`Sending request to URL: ${url}`);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to get Floaty balances by address: ${response.statusText}`);
    }
    const data = await response.json(); // Await the JSON parsing
    return adjustNumbers(data); // Return the resolved and adjusted data
  } catch (error) {
    console.error(`Error fetching Floaty balances for address ${address}:`, error);
    return { error: "something went wrong" }; // Return an error message on failure
  }
}

// Retrieves all Floaty balances for a specified FID
async function getFloatyBalancesByFID(fid) {
  const resolvedFID = await resolveFID(fid);
  if (!resolvedFID) {
    return { error: "Invalid FID or username" }; // Handle cases where FID cannot be resolved
  }

  const url = `${BASE_URL}/floaties/balance/fid/${resolvedFID}`;
  console.log(`Sending request to URL: ${url}`);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to get Floaty balances by FID: ${response.statusText}`);
    }
    const data = await response.json(); // Await the JSON parsing
    return adjustNumbers(data); // Return the resolved and adjusted data
  } catch (error) {
    console.error(`Error fetching Floaty balances for FID ${resolvedFID}:`, error);
    return { error: "something went wrong" }; // Return an error message on failure
  }
}

module.exports = {
  verifyTip,
  getFloatyLeaderboard,
  getUserHamInfo,
  getFloatiesLeaderboard,
  getFloatyReceiversLeaderboard,
  getFloatyBalancesByAddress,
  getFloatyBalancesByFID,
  getHamScores,
};