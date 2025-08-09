# Local Development with ngrok

This document explains how to use ngrok for local testing of Gmail Pub/Sub webhooks.

## Prerequisites

- ngrok installed and configured
- Google Cloud service account with Pub/Sub permissions
- Gmail OAuth app configured

## Quick Setup (Recommended)

### 1. Install ngrok

```bash
# macOS
brew install ngrok

# Other platforms: https://ngrok.com/download
```

### 2. Configure ngrok Authentication

1. **Sign up for ngrok**: https://dashboard.ngrok.com/signup
2. **Get your authtoken**: https://dashboard.ngrok.com/get-started/your-authtoken
3. **Install your authtoken**:
   ```bash
   ngrok authtoken YOUR_TOKEN_HERE
   ```

### 3. Start ngrok and Development Server

**Option A: Two-terminal setup (Recommended)**
```bash
# Terminal 1: Start ngrok
ngrok http 3000

# Terminal 2: Copy the https URL and start dev server  
NGROK_URL=https://abc123.ngrok.io npm run dev
```

**Option B: Use the helper script**
```bash
# This shows instructions and starts the dev server
npm run dev:ngrok

# The script will display instructions and start the dev server
# Follow the displayed instructions to set up ngrok manually in another terminal
```

**Option C: Quick command reference**
```bash
# Get a reminder of the command format
npm run dev:with-ngrok
```

### 4. Helper Scripts

```bash
# Start ngrok with random subdomain
npm run ngrok:tunnel

# Start ngrok with custom subdomain (paid plans only)
npm run ngrok:start
```

## How It Works

1. **ngrok tunnel**: Creates a secure tunnel from the internet to your local port 3000
2. **Environment variable**: The `NGROK_URL` is automatically set by the startup script
3. **Webhook configuration**: Gmail Pub/Sub subscriptions automatically use the ngrok URL for webhooks
4. **Real-time testing**: Gmail notifications are sent directly to your local development server

## Testing

### 1. Verify ngrok is working

Visit your ngrok URL in a browser - you should see your local Next.js app.

### 2. Test Gmail provider setup

1. Go to Email Settings in your local app
2. Create a new Gmail provider
3. Complete OAuth authorization
4. Check the logs for Pub/Sub setup confirmation

### 3. Test webhook delivery

1. Send an email to the configured Gmail account
2. Check your development server logs for webhook notifications
3. Look for log messages like:
   ```
   🔔 Google Pub/Sub webhook notification received
   📧 Decoded Gmail notification
   ✅ Published INBOUND_EMAIL_RECEIVED event
   ```

## Environment Variables

The ngrok integration uses these environment variables:

- `NGROK_URL`: Set automatically by the startup script
- `NGROK_SUBDOMAIN`: Optional, for custom subdomain (paid ngrok plans)

## Troubleshooting

### ngrok tunnel not starting

- Check if port 3000 is available
- Verify ngrok is installed: `ngrok version`
- For subdomain issues, check your ngrok plan

### Webhook not receiving notifications

- Verify the ngrok URL is accessible from the internet
- Check Google Cloud Console for Pub/Sub subscription configuration
- Ensure Gmail watch subscription is active (7-day expiration)

### Gmail watch subscription expired

Gmail watch subscriptions expire after 7 days. The system automatically renews them during OAuth authorization, but you can manually refresh by re-authorizing the Gmail provider.

## Security Notes

- ngrok tunnels are publicly accessible
- Don't use production credentials in development
- Consider using ngrok's authentication features for sensitive testing

## Scripts Reference

- `npm run dev:ngrok`: Start both ngrok and development server
- `npm run ngrok:start`: Start ngrok with custom subdomain
- `npm run ngrok:tunnel`: Start ngrok with random subdomain
- `node scripts/dev-with-ngrok.js`: Direct script execution