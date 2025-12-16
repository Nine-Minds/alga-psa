# How to Get Your PostHog API Key: Step-by-Step Guide

## Overview

PostHog uses different types of API keys for different purposes. This guide will walk you through finding your Project API Key in the PostHog dashboard and explain the differences between public and private keys.

## Understanding PostHog API Keys

### Types of Keys

1. **Project API Key (Public Key)**
   - Used for client-side integrations (JavaScript, mobile apps)
   - Safe to expose in frontend code
   - Allows sending events and identifying users
   - Cannot read or modify data

2. **Personal API Key (Private Key)**
   - Used for server-side integrations and API access
   - Must be kept secret
   - Allows full read/write access to your data
   - Used for administrative tasks and data retrieval

## Step-by-Step Guide to Finding Your Project API Key

### Step 1: Log in to PostHog

1. Navigate to [app.posthog.com](https://app.posthog.com) (or your self-hosted PostHog instance)
2. Enter your email and password
3. Click "Sign in"

**[Screenshot: PostHog login page showing email and password fields with the Sign in button]**

### Step 2: Access Your Project Settings

Once logged in, you'll be in your PostHog dashboard.

1. Look for the gear icon (⚙️) in the left sidebar
2. Click on "Project settings"
   - Alternatively, you can click on your project name at the top of the sidebar and select "Project settings" from the dropdown

**[Screenshot: PostHog dashboard with left sidebar highlighted, showing the gear icon for Project settings]**

### Step 3: Navigate to the Project API Keys Section

In the Project Settings page:

1. Look for the "Project API key" section near the top of the page
2. You'll see your Project API key displayed in a box

**[Screenshot: Project Settings page with the Project API key section highlighted]**

### Step 4: Copy Your Project API Key

1. Your Project API key will be displayed in a format like: `phc_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890`
2. Click the "Copy" button next to the key
3. The key will be copied to your clipboard

**[Screenshot: Close-up of the Project API key field with the Copy button highlighted]**

## Finding Your Personal API Key (Private Key)

If you need a Personal API Key for server-side operations:

### Step 1: Access Account Settings

1. Click on your profile picture or initials in the bottom-left corner
2. Select "Account settings" from the menu

**[Screenshot: Profile menu dropdown with "Account settings" option highlighted]**

### Step 2: Navigate to Personal API Keys

1. In the Account Settings page, find the "Personal API keys" section
2. Click on "Personal API keys" in the sidebar

**[Screenshot: Account Settings page with Personal API keys section in the sidebar]**

### Step 3: Create or View Personal API Key

1. If you don't have a Personal API key yet, click "Create personal API key"
2. Give your key a descriptive name (e.g., "Server Integration")
3. Select the appropriate scopes/permissions
4. Click "Create key"
5. **Important**: Copy the key immediately - you won't be able to see it again!

**[Screenshot: Personal API keys page showing the Create personal API key button and existing keys list]**

## Important Security Notes

### Project API Key (Public)
- ✅ Safe to use in client-side code
- ✅ Can be committed to version control
- ✅ Visible in browser developer tools
- ❌ Cannot perform administrative actions

### Personal API Key (Private)
- ❌ Never expose in client-side code
- ❌ Never commit to version control
- ✅ Use environment variables to store
- ✅ Full access to read/write data

## Using Your API Keys

### Client-Side (JavaScript) Example
```javascript
posthog.init('phc_YourProjectAPIKeyHere', {
    api_host: 'https://app.posthog.com'
});
```

### Server-Side Example
```javascript
// Store in environment variable
const POSTHOG_PERSONAL_API_KEY = process.env.POSTHOG_PERSONAL_API_KEY;

// Use for API requests
const response = await fetch('https://app.posthog.com/api/projects/', {
    headers: {
        'Authorization': `Bearer ${POSTHOG_PERSONAL_API_KEY}`
    }
});
```

## Troubleshooting

### Can't Find Your Project API Key?
- Ensure you have the appropriate permissions in your organization
- Check that you're in the correct project (if you have multiple projects)
- Contact your PostHog administrator if you lack access

### API Key Not Working?
- Verify you're using the correct type of key for your use case
- Check that the key hasn't been revoked or expired
- Ensure you're using the correct API endpoint

## Additional Resources

- [PostHog API Documentation](https://posthog.com/docs/api)
- [PostHog JavaScript Library Guide](https://posthog.com/docs/libraries/js)
- [PostHog Security Best Practices](https://posthog.com/docs/privacy/security)

---

**Note**: The interface may vary slightly depending on your PostHog version and whether you're using PostHog Cloud or a self-hosted instance.