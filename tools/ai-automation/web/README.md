# AI Automation Control Panel

This is the control panel for the AI Automation tool, built with Next.js. It provides:

- Real-time browser feed via WebSockets
- AI-powered automation control
- Script execution interface
- Activity logging
- Puppeteer browser automation

## Getting Started with the Control Panel

1. Install dependencies:
   ```bash
   npm install
   npm install puppeteer
   ```

2. Run the development server:
   ```bash
   npm run dev
   ```

3. Open your browser and navigate to:
   [http://localhost:3000](http://localhost:3000)

## Puppeteer Automation

The control panel integrates with Puppeteer for browser automation. Available features:

### API Endpoints

- POST /api/puppeteer/launch - Launch a new browser instance
- POST /api/puppeteer/close - Close browser instance
- POST /api/puppeteer/navigate - Navigate to URL
- POST /api/puppeteer/screenshot - Take page screenshot
- POST /api/puppeteer/execute - Execute custom Puppeteer script

### AI Tool Usage

The AI can control Puppeteer through tool use commands:

```xml
<use_mcp_tool>
  <server_name>puppeteer</server_name>
  <tool_name>execute_script</tool_name>
  <arguments>
    {
      "script": "async (page) => { await page.goto('https://example.com'); }"
    }
  </arguments>
</use_mcp_tool>
```

Available Puppeteer tools:
- execute_script - Execute Puppeteer script
- take_screenshot - Capture page screenshot
- navigate_to - Navigate to URL
- extract_content - Extract page content
- fill_form - Fill form fields

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

For detailed setup instructions, see the [Getting Started Guide](../../../docs/getting-started.md).

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
