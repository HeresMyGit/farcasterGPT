# XMTP Integration Setup Guide

This guide explains how to set up and use the XMTP (Extensible Message Transport Protocol) integration in your FarcasterGPT bot.

## What is XMTP?

XMTP is a decentralized messaging protocol that enables secure, private communication between Ethereum addresses. With this integration, your bot can:

- Receive direct messages through XMTP-compatible clients
- Respond with the same AI capabilities as your Farcaster bot
- Maintain conversation context across messages
- Use all existing assistant features (function calls, image generation, etc.)

## Quick Setup

### 1. Generate XMTP Keys

Run the key generation script to create the required environment variables:

```bash
npm run gen:xmtp-keys
```

This will automatically add the following to your `.env` file:
- `WALLET_KEY` - Private key for the bot's Ethereum wallet
- `ENCRYPTION_KEY` - Encryption key for the local XMTP database
- `XMTP_ENV` - XMTP network environment (dev/production)

### 2. Start the Application

```bash
npm start
```

The application will now start both:
- The existing Farcaster webhook server (port 3000)
- The XMTP message listener

### 3. Test the Integration

1. Check server status: `http://localhost:3000/xmtp-status`
2. Get your bot's Ethereum address from the console logs
3. Send a message to your bot at: `https://xmtp.chat/dm/[BOT_ADDRESS]`

## Environment Variables

### Required for XMTP
```bash
PRIVATE_KEY=b0aefb07...    # Private key for the bot's wallet (you already have this)
ENCRYPTION_KEY=fee229e2... # Hex-encoded encryption key for local DB (now added)
XMTP_ENV=production       # XMTP network: dev, production (you already have this)
```

### Optional for XMTP
```bash
XMTP_MODEL=asst_xyz...    # OpenAI assistant ID specifically for XMTP (falls back to ASST_MODEL)
```

### Existing Required Variables
All your existing environment variables are still required:
- `OPENAI_API_KEY`
- `ASST_MODEL` (used as fallback if XMTP_MODEL not set)
- `NEYNAR_API_KEY`
- `SIGNER_UUID`
- etc.

## How It Works

### Message Flow
1. User sends message via XMTP client (like xmtp.chat)
2. XMTP server receives the message
3. Message is processed by the existing assistant logic
4. Response is sent back through XMTP
5. Conversation context is maintained using OpenAI threads

### Integration Points
- **Thread Management**: Each XMTP conversation gets its own OpenAI thread
- **Assistant Features**: Full access to all existing functions (image generation, token creation, etc.)
- **Personal Prompts**: XMTP users can set personal prompts just like Farcaster users
- **Conversation Analytics**: Rich metadata about conversations and participants
- **Error Handling**: Graceful fallbacks and error messages

### Conversation Metadata Available
- **Basic Info**: Conversation ID, creation date, participant count, message count
- **Participants**: Inbox IDs, device installations, roles
- **Message History**: Stats by participant, content types, timestamps
- **Activity Status**: Last activity, conversation age, activity patterns

## Files Added

### Core Files
- `xmtpHelpers.js` - Utility functions for XMTP client management
- `xmtpServer.js` - Main XMTP server class and message handling
- `xmtpUtils.js` - Conversation analytics and metadata utilities
- `generateXMTPKeys.js` - Key generation utility

### Modified Files
- `index.js` - Added XMTP server initialization
- `assistant.js` - Added `processXMTPMessage()` function
- `webhook.js` - Added XMTP status endpoint
- `package.json` - Added key generation script

## Testing

### Local Testing
1. Generate keys: `npm run gen:xmtp-keys`
2. Start server: `npm start`
3. Check logs for bot address
4. Visit `https://xmtp.chat/dm/[BOT_ADDRESS]`
5. Send a test message

### Special Commands
- Send `/info` or `/conversation` to get detailed conversation analytics
- All existing assistant functions work (image generation, token creation, etc.)
- Personal prompts: `#personalprompt [your custom instructions]`

### Status Endpoints
- `GET /` - General server status
- `GET /xmtp-status` - XMTP-specific status

## Troubleshooting

### XMTP Server Won't Start
- Verify `WALLET_KEY` and `ENCRYPTION_KEY` are in `.env`
- Check console logs for specific error messages
- Ensure all dependencies are installed: `npm install`

### Messages Not Responding
- Check XMTP environment (`dev` vs `production`)
- Verify bot address is correct
- Look for error messages in console logs
- Try regenerating keys if database corruption suspected

### Database Issues
- Delete `.data/xmtp/` directory to reset local database
- Regenerate encryption key if needed
- Check file permissions on data directory

## Advanced Configuration

### Custom Database Path
Set `RAILWAY_VOLUME_MOUNT_PATH` to customize where XMTP stores its database:
```bash
RAILWAY_VOLUME_MOUNT_PATH=/custom/path
```

### Network Environments
- `dev` - Development network (recommended for testing)
- `production` - Production network (for live deployments)

### Performance Tuning
The XMTP integration is designed to work alongside your existing Farcaster bot without conflicts. Both systems can run simultaneously and share the same assistant logic.

## Security Notes

- Keep your `WALLET_KEY` secure - it controls the bot's Ethereum identity
- The `ENCRYPTION_KEY` protects your local message database
- XMTP messages are end-to-end encrypted by default
- Consider using a dedicated wallet for the bot (separate from any personal funds)

## Getting Help

If you encounter issues:
1. Check the console logs for detailed error messages
2. Verify all environment variables are set correctly
3. Test with the key generation script to ensure proper setup
4. Check XMTP network status if connection issues persist 