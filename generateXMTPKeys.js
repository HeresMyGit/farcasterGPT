#!/usr/bin/env node

// generateXMTPKeys.js
// Utility script to generate XMTP keys for the .env file

const fs = require('fs');
const path = require('path');
const { createWalletClient, http } = require('viem');
const { generatePrivateKey } = require('viem/accounts');
const { sepolia } = require('viem/chains');

// Simple encryption key generation without dependencies
function generateEncryptionKeyHex() {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('hex');
}

function generateXMTPKeys() {
  console.log('🔑 Checking XMTP configuration...\n');

  const envPath = path.resolve(process.cwd(), '.env');
  let currentEnv = '';
  let hasPrivateKey = false;
  let hasEncryptionKey = false;
  let hasXmtpEnv = false;

  // Check existing .env file
  if (fs.existsSync(envPath)) {
    currentEnv = fs.readFileSync(envPath, 'utf-8');
    hasPrivateKey = currentEnv.includes('PRIVATE_KEY=');
    hasEncryptionKey = currentEnv.includes('ENCRYPTION_KEY=');
    hasXmtpEnv = currentEnv.includes('XMTP_ENV=');
  }

  console.log(`✅ PRIVATE_KEY: ${hasPrivateKey ? 'Found' : 'Missing'}`);
  console.log(`${hasEncryptionKey ? '✅' : '❌'} ENCRYPTION_KEY: ${hasEncryptionKey ? 'Found' : 'Missing'}`);
  console.log(`✅ XMTP_ENV: ${hasXmtpEnv ? 'Found' : 'Will use default'}\n`);

  if (hasPrivateKey && hasEncryptionKey) {
    console.log('🎉 All XMTP keys are already configured!');
    console.log('Your bot is ready to use XMTP messaging.');
    return;
  }

  let envContent = '';

  if (!hasPrivateKey) {
    // Generate a new private key only if one doesn't exist
    const privateKey = generatePrivateKey();
    console.log(`Generated PRIVATE_KEY: ${privateKey}`);
    envContent += `PRIVATE_KEY=${privateKey}\n`;
  }

  if (!hasEncryptionKey) {
    // Generate encryption key
    const encryptionKey = generateEncryptionKeyHex();
    console.log(`Generated ENCRYPTION_KEY: ${encryptionKey}`);
    envContent += `ENCRYPTION_KEY=${encryptionKey}\n`;
  }

  if (!hasXmtpEnv) {
    // Default XMTP environment
    const xmtpEnv = 'dev';
    console.log(`Default XMTP_ENV: ${xmtpEnv}`);
    envContent += `XMTP_ENV=${xmtpEnv}\n`;
  }

  if (envContent) {
    if (fs.existsSync(envPath)) {
      console.log('\n📁 Adding missing keys to existing .env file...');
      fs.appendFileSync(envPath, '\n' + envContent);
    } else {
      console.log('\n📁 Creating new .env file with XMTP keys...');
      fs.writeFileSync(envPath, envContent.trim());
    }
    console.log('✅ XMTP configuration updated successfully!');
  }

  console.log('\n🎉 XMTP key generation complete!');
  console.log('\n📖 Next steps:');
  console.log('1. Ensure all other required environment variables are set in .env');
  console.log('2. Restart your application to enable XMTP functionality');
  console.log('3. Test messaging at https://xmtp.chat with your bot\'s address');
}

// Run the key generation if this script is executed directly
if (require.main === module) {
  generateXMTPKeys();
}

module.exports = { generateXMTPKeys }; 