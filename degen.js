const fetch = require('node-fetch');
const farcaster = require('./farcaster'); 

// Fetch Airdrop Points by Wallet, Season, and optional FID
async function fetchAirdropPoints(season = 'current', wallet = null, FID = null) {
  try {
    // Step 1: If FID is provided, resolve the FID to get the verified Ethereum wallet
    if (FID) {
      console.log(`FID provided: ${FID}. Attempting to resolve to Ethereum wallet...`);
      wallet = await getVerifiedWallet(FID); // Get the verified wallet for the provided FID
      if (!wallet) {
        return { error: `Could not retrieve wallet for FID: ${FID}` };
      }
    }

    // Step 2: Ensure that a wallet address is available
    if (!wallet) {
      return { error: 'No wallet address provided.' };
    }

    // Step 3: Fetch airdrop points for the given wallet and season
    const url = `https://api.degen.tips/airdrop2/${season}/points?wallet=${wallet}`;
    console.log(`Fetching airdrop points for season: ${season}, wallet: ${wallet}`);

    const response = await fetch(url);
    if (!response.ok) {
      return { error: `Error fetching airdrop points: ${response.statusText}` };
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching airdrop points:', error.message);
    return { error: error.message };
  }
}

// Fetch Airdrop Allowances by Wallet or FID
async function fetchAirdropAllowances({ wallet, fid }) {
  let resolvedFID = null;
  if (fid) {
    resolvedFID = await farcaster.resolveFID(fid); // Resolve and clean FID
  }

  const params = new URLSearchParams();
  if (wallet) params.append('wallet', wallet);
  if (resolvedFID) params.append('fid', resolvedFID);
  
  const url = `https://api.degen.tips/airdrop2/allowances?${params.toString()}`;
  try {
    console.log(`Fetching airdrop allowances for wallet: ${wallet}, FID: ${resolvedFID}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Error fetching airdrop allowances: ${response.statusText}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error:', error);
    return { error: error.message };
  }
}

// Fetch Airdrop Tips by FID
async function fetchAirdropTips(fid, limit = 10, offset = 0) {
  const resolvedFID = await farcaster.resolveFID(fid); // Resolve and clean FID
  const url = `https://api.degen.tips/airdrop2/tips?fid=${resolvedFID}&limit=${limit}&offset=${offset}`;
  try {
    console.log(`Fetching airdrop tips for FID: ${resolvedFID}, limit: ${limit}, offset: ${offset}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Error fetching airdrop tips: ${response.statusText}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error:', error);
    return { error: error.message };
  }
}

// Export the functions so they can be used elsewhere in the application
module.exports = {
  fetchAirdropPoints,
  fetchAirdropAllowances,
  fetchAirdropTips,
};