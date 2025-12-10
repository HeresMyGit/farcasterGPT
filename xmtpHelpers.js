// xmtpHelpers.js

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client, IdentifierKind } = require('@xmtp/node-sdk');
const { createWalletClient, http, toBytes } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { sepolia } = require('viem/chains');

/**
 * Create a user object with wallet client
 * @param {string} key - Private key
 * @returns {Object} User object with key, account, and wallet
 */
const createUser = (key) => {
  const account = privateKeyToAccount(key);
  return {
    key: key,
    account,
    wallet: createWalletClient({
      account,
      chain: sepolia,
      transport: http(),
    }),
  };
};

/**
 * Create a signer for XMTP client
 * @param {string} key - Private key 
 * @returns {Object} Signer object
 */
const createSigner = (key) => {
  const sanitizedKey = key.startsWith("0x") ? key : `0x${key}`;
  const user = createUser(sanitizedKey);
  return {
    type: "EOA",
    getIdentifier: () => ({
      identifierKind: IdentifierKind.Ethereum,
      identifier: user.account.address.toLowerCase(),
    }),
    signMessage: async (message) => {
      const signature = await user.wallet.signMessage({
        message,
        account: user.account,
      });
      return toBytes(signature);
    },
  };
};

/**
 * Generate a random encryption key
 * @returns {string} The encryption key as hex string
 */
const generateEncryptionKeyHex = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Get the encryption key from a hex string
 * @param {string} hex - The hex string
 * @returns {Uint8Array} The encryption key
 */
const getEncryptionKeyFromHex = (hex) => {
  return Buffer.from(hex, 'hex');
};

/**
 * Get database path for XMTP client
 * @param {string} description - Description for the database
 * @returns {string} Database path
 */
const getDbPath = (description = "xmtp") => {
  // Checks if the environment is a Railway deployment
  const volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH ?? ".data/xmtp";
  // Create database directory if it doesn't exist
  if (!fs.existsSync(volumePath)) {
    fs.mkdirSync(volumePath, { recursive: true });
  }
  return `${volumePath}/${description}.db3`;
};

/**
 * Log agent details for XMTP client
 * @param {Client|Client[]} clients - XMTP client(s)
 */
const logAgentDetails = async (clients) => {
  const clientArray = Array.isArray(clients) ? clients : [clients];
  const clientsByAddress = clientArray.reduce((acc, client) => {
    const address = client.accountIdentifier?.identifier;
    acc[address] = acc[address] ?? [];
    acc[address].push(client);
    return acc;
  }, {});

  for (const [address, clientGroup] of Object.entries(clientsByAddress)) {
    const firstClient = clientGroup[0];
    const inboxId = firstClient.inboxId;
    const installationId = firstClient.installationId;
    const environments = clientGroup
      .map((c) => c.options?.env ?? "dev")
      .join(", ");
    
    console.log(`\x1b[38;2;252;76;52m
        ██╗  ██╗███╗   ███╗████████╗██████╗ 
        ╚██╗██╔╝████╗ ████║╚══██╔══╝██╔══██╗
         ╚███╔╝ ██╔████╔██║   ██║   ██████╔╝
         ██╔██╗ ██║╚██╔╝██║   ██║   ██╔═══╝ 
        ██╔╝ ██╗██║ ╚═╝ ██║   ██║   ██║     
        ╚═╝  ╚═╝╚═╝     ╚═╝   ╚═╝   ╚═╝     
      \x1b[0m`);

    const urls = [`http://xmtp.chat/dm/${address}`];

    const conversations = await firstClient.conversations.list();
    const inboxState = await firstClient.preferences.inboxState();

    console.log(`
    ✓ XMTP Client:
    • InboxId: ${inboxId}
    • Bindings: ${Client.version}
    • Address: ${address}
    • Conversations: ${conversations.length}
    • Installations: ${inboxState.installations.length}
    • InstallationId: ${installationId}
    • Networks: ${environments}
    ${urls.map((url) => `• URL: ${url}`).join("\n")}`);
  }
};

/**
 * Validate required environment variables
 * @param {string[]} vars - Array of required environment variable names
 * @returns {Object} Object with environment variables
 */
function validateEnvironment(vars) {
  const missing = vars.filter((v) => !process.env[v]);

  if (missing.length) {
    try {
      const envPath = path.resolve(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        const envVars = fs
          .readFileSync(envPath, "utf-8")
          .split("\n")
          .filter((line) => line.trim() && !line.startsWith("#"))
          .reduce((acc, line) => {
            const [key, ...val] = line.split("=");
            if (key && val.length) acc[key.trim()] = val.join("=").trim();
            return acc;
          }, {});

        missing.forEach((v) => {
          if (envVars[v]) process.env[v] = envVars[v];
        });
      }
    } catch (e) {
      console.error('Error reading .env file:', e);
    }

    const stillMissing = vars.filter((v) => !process.env[v]);
    if (stillMissing.length) {
      console.error("Missing env vars:", stillMissing.join(", "));
      process.exit(1);
    }
  }

  return vars.reduce((acc, key) => {
    acc[key] = process.env[key];
    return acc;
  }, {});
}

module.exports = {
  createUser,
  createSigner,
  generateEncryptionKeyHex,
  getEncryptionKeyFromHex,
  getDbPath,
  logAgentDetails,
  validateEnvironment,
}; 