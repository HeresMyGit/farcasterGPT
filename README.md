# FarcasterGPT

A comprehensive AI-powered bot for Farcaster with XMTP messaging, NFT minting, and Twitter integration.

## 🔐 Security Setup (Important!)

This project requires several API keys and sensitive credentials. **Never commit your actual `.env` file to version control.**

### Environment Setup

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Fill in your actual API keys and credentials in `.env`

3. Verify your `.env` file is ignored by git:
   ```bash
   git check-ignore .env
   # Should output: .env
   ```

### Required Environment Variables

| Variable | Description | Where to Get It |
|----------|-------------|-----------------|
| `NEYNAR_API_KEY` | Farcaster API access | [Neynar Dashboard](https://neynar.com) |
| `OPENAI_API_KEY` | OpenAI API access | [OpenAI Platform](https://platform.openai.com) |
| `OPENAI_ORG` | OpenAI Organization ID | OpenAI Platform Settings |
| `ASST_MODEL` | OpenAI Assistant ID | Create in OpenAI Playground |
| `PRIVATE_KEY` | Ethereum private key | Your wallet (use a dedicated bot wallet) |
| `ENCRYPTION_KEY` | 64-char hex for XMTP | Generate with `npm run gen:xmtp-keys` |
| `SIGNER_UUID` | Farcaster signer UUID | Neynar Dashboard |
| `INFURA_PROJECT_ID` | Infura project ID | [Infura Dashboard](https://infura.io) |
| `INFURA_PROJECT_SECRET` | Infura project secret | Infura Dashboard |

## 🚀 Quick Start

1. **Clone and install dependencies:**
   ```bash
   git clone <your-repo>
   cd farcasterGPT
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your actual credentials
   ```

3. **Generate XMTP keys:**
   ```bash
   npm run gen:xmtp-keys
   ```

4. **Start the application:**
   ```bash
   npm start
   ```

## 🔑 Security Best Practices

- **Use a dedicated wallet** for the bot with minimal funds
- **Never share your `.env` file** or commit it to version control
- **Rotate API keys regularly** especially if compromised
- **Monitor your bot's wallet** for unusual activity
- **Use environment-specific configs** for development vs production

## 📡 Features

- **Farcaster Integration**: Responds to mentions and casts
- **XMTP Messaging**: Direct messaging support
- **NFT Minting**: Automated NFT creation on Zora
- **Twitter Integration**: Cross-platform posting
- **AI Assistant**: OpenAI-powered responses

## 🔧 Development

### Running in Development
```bash
npm run dev
```

### Testing XMTP
```bash
# Check XMTP status
curl http://localhost:3000/xmtp-status
```

### Testing Webhooks
```bash
# Test Farcaster webhook
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d @test-payload.json
```

## 🌐 Deployment

When deploying to production:

1. **Set environment to production:**
   ```bash
   XMTP_ENV=production
   ```

2. **Use secure secret management:**
   - Railway: Use environment variables
   - Vercel: Use environment variables
   - Docker: Use secrets or environment files

3. **Monitor logs** for any exposed credentials

## ⚠️ Important Security Notes

- The `PRIVATE_KEY` controls an Ethereum wallet - keep it secure!
- XMTP database files (`*.db3`) contain encrypted messages - they're in `.gitignore`
- All API keys should be treated as passwords
- Consider using a hardware wallet or multi-sig for production funds

## 🤝 Contributing

Before contributing:
1. Ensure no secrets are in your commits
2. Test with dummy/testnet credentials
3. Follow the existing environment variable patterns
4. Update this README if adding new environment variables

## 📝 License

[Your License Here] 