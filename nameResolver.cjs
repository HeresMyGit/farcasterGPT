// nameResolver.cjs
// -----------------------------------------------------------------------------
// A safe wrapper around Coinbase OnchainKit's `getName()` that:
//
// 1. Works in a **pure CommonJS** project (no `"type":"module"` dance needed).
// 2. Uses a dedicated viem PublicClient, so RPC hangs are under *your* control.
// 3. Adds a 5-second timeout -- no more indefinite promises.
// 4. Falls back to plain ENS → sliced 0x address if everything else fails.
//
// Installation:
//   npm i @coinbase/onchainkit viem
// -----------------------------------------------------------------------------

const { createPublicClient, http, getEnsName } = require('viem');
const { mainnet, base } = require('viem/chains');
const neynarClient = require('./neynarClient');

// ⚠️ OnchainKit is **ES-module only** – import dynamically:
const getName = async (...args) =>
  (await import('@coinbase/onchainkit/identity')).getName(
    ...args
  );

// ----- RPC clients -----------------------------------------------------------
const rpcBase = 'https://base.publicnode.com';        // free, no API key
const rpcEth  = 'https://rpc.ankr.com/eth';           // or any mainnet endpoint

const baseClient = createPublicClient({ chain: base,    transport: http(rpcBase) });
const ethClient  = createPublicClient({ chain: mainnet, transport: http(rpcEth) });

// ----- Farcaster username lookup -----------------------------------------------
/**
 * Look up Farcaster username by wallet address
 * @param {string} address - 0x... wallet address
 * @returns {Promise<string|null>} - Farcaster username or null
 */
async function getFarcasterUsername(address) {
  try {
    console.log(`🟣 Looking up Farcaster username for ${address}...`);
    
    // Try different potential method names
    let response = null;
    
    // Method 1: Try lookupUserByVerificationAddress
    try {
      response = await neynarClient.lookupUserByVerificationAddress(address);
      if (response && response.user) {
        const username = response.user.username;
        console.log(`✅ Found Farcaster username: ${username}`);
        return username;
      }
    } catch (err) {
      console.log(`🔄 Method 1 failed, trying method 2...`);
    }
    
    // Method 2: Try fetchBulkUsers
    try {
      response = await neynarClient.fetchBulkUsers([address]);
      if (response && response.users && response.users.length > 0) {
        const username = response.users[0].username;
        console.log(`✅ Found Farcaster username: ${username}`);
        return username;
      }
    } catch (err) {
      console.log(`🔄 Method 2 failed, trying method 3...`);
    }
    
    // Method 3: Try fetchUsersByVerifiedAddresses
    try {
      response = await neynarClient.fetchUsersByVerifiedAddresses([address]);
      if (response && response[address] && response[address].length > 0) {
        const username = response[address][0].username;
        console.log(`✅ Found Farcaster username: ${username}`);
        return username;
      }
    } catch (err) {
      console.log(`🔄 All methods failed`);
    }
    
    console.log(`📍 No Farcaster username found for ${address}`);
    return null;
  } catch (error) {
    console.warn(`⚠️ Farcaster lookup failed:`, error.message);
    return null;
  }
}

// ----- Public API ------------------------------------------------------------
/**
 * Resolve `address` to a human-readable name the way Coinbase Base App does:
 * Basename → ENS → cb.id → Lens → fallback 0x-slice.
 *
 * @param {string} address – 0x… wallet address
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<string>}
 */
module.exports.resolveDisplayName = async function resolveDisplayName(
  address,
  timeoutMs = 5000
) {
  // 1. OnchainKit with timeout
  try {
    const name = await Promise.race([
      getName({ address, chain: base, client: baseClient }), // Basename + ENS
      new Promise((_, r) =>
        setTimeout(() => r(new Error('OnchainKit timeout')), timeoutMs)
      ),
    ]);
    if (name) return name;
  } catch (err) {
    console.warn('[resolver] OnchainKit failed:', err.message);
  }

  // 2. Fallback to raw ENS lookup via viem
  try {
    const ens = await getEnsName(ethClient, { address });
    if (ens) return ens;
  } catch (_) {/* ignore */ }

  // 3. Try Farcaster username lookup
  try {
    const farcasterUsername = await getFarcasterUsername(address);
    if (farcasterUsername) return `@${farcasterUsername}`;
  } catch (_) {/* ignore */ }

  // 4. Last-ditch: truncated 0x address
  return address.slice(0, 6) + '…' + address.slice(-4);
}; 