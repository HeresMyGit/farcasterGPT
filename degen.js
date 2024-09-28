const fetch = require('node-fetch');
const farcaster = require('./farcaster'); 

// Fetch Airdrop Points by Wallet and Season
async function fetchAirdropPoints(season = 'current', wallet) {
  const url = `https://api.degen.tips/airdrop2/${season}/points?wallet=${wallet}`;
  try {
    console.log(`Fetching airdrop points for season: ${season}, wallet: ${wallet}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Error fetching airdrop points: ${response.statusText}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error:', error);
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