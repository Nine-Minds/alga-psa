# Verification Guide: Ensuring Next.js is Running Without Express

## Quick Check Commands

### 1. Check which server starts by default:
```bash
# This should show "Starting with Next.js directly..."
npm start --dry-run
```

### 2. Start dev server and check console output:
```bash
npm run dev
# Should show: ▲ Next.js 14.x.x
# Should NOT show: "Starting with Express server wrapper..."
```

### 3. Check running processes:
```bash
# While dev server is running, in another terminal:
ps aux | grep node

# ✅ Good: You should see "next dev" or "next start"
# ❌ Bad: You should NOT see "tsx index.ts"
```

## Server Mode Reference

| Command | What it runs | Express? |
|---------|------------|----------|
| `npm run dev` | Next.js dev server | ❌ NO |
| `npm run dev:express` | Express wrapper + Next.js | ✅ YES |
| `npm run dev:turbo` | Next.js with Turbopack | ❌ NO |
| `npm start` | Next.js production (default) | ❌ NO |
| `USE_EXPRESS_SERVER=true npm start` | Express wrapper | ✅ YES |

## Files That Control This

1. **`package.json` scripts:**
   - `"dev": "next dev"` - Direct Next.js
   - `"dev:express": "...tsx index.ts"` - Express wrapper

2. **`scripts/start.js`:**
   - Checks `USE_EXPRESS_SERVER` environment variable
   - Default (undefined/false) = Next.js
   - `true` = Express

3. **`server/src/middleware.ts`:**
   - This is Next.js middleware (NOT Express middleware)
   - Handles all authentication directly in Next.js

## How to Test Authentication is Working

```bash
# 1. Start the server
npm run dev

# 2. Test health check (no auth required)
curl http://localhost:3000/api/healthz

# 3. Test API endpoint (requires API key)
curl http://localhost:3000/api/v1/users \
  -H "x-api-key: YOUR_ACTUAL_KEY"

# Should get 401 without valid key
curl http://localhost:3000/api/v1/users
# Response: {"error":"Unauthorized: API key missing"}
```

## Confirming Express is NOT in Use

When running `npm run dev`, you should see:

```
> server@0.9.4 dev
> next dev

  ▲ Next.js 14.0.0
  - Local:        http://localhost:3000
  - Environments: .env
```

NOT this:
```
Starting with Express server wrapper...
> Ready on http://localhost:3000
```

## To Remove Express Completely (Optional)

If you want to remove Express dependencies entirely:

```bash
# Remove Express dependencies
npm uninstall express cookie-parser @types/express @types/cookie-parser

# Remove the Express server file
rm index.ts

# Remove Express middleware directory
rm -rf src/middleware/express

# Update scripts/start.js to only use Next.js
```

But keeping them allows easy rollback if issues arise!