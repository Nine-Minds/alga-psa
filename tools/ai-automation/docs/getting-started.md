# Getting Started

Welcome to the **AI-Driven Automation Tool**! This tool allows an AI (e.g., OpenAI GPT-4) to script and control a real web browser (via Puppeteer), stream its screen in real time, and optionally ask you for clarifications during the process.

## Prerequisites

1. **Docker** installed on your machine.  
2. **Node.js (v16 or higher)** for running the Next.js front end locally.  
3. An **OpenAI API key** (if you plan to integrate with GPT-4 or GPT-3.5).  

## Repository Structure

```
tools
└── ai-automation
    ├── Dockerfile
    ├── package.json
    ├── tsconfig.json
    ├── src
    │   ├── index.ts           # Express server entry
    │   └── puppeteerManager.ts
    └── web
        ├── package.json
        ├── next.config.js
        └── app
            └── page.tsx       # Next.js control panel
```

## 1. Build and Run the Puppeteer Server

In the `tools/ai-automation` directory:

1. **Build the Docker image**:
   ```bash
   docker build --platform linux/amd64 -t ai-automation .
   ```

2. **Run the Docker container**:
   ```bash
   docker run --rm -p 4000:4000 ai-automation
   ```
   
   - The server is now running on `localhost:4000`.  
   - This server:
     - Launches a **persistent Puppeteer** browser (Chrome/Chromium).  
     - Exposes endpoints for arbitrary script execution (`/api/script`), page observation (`/api/observe`), and screenshot streaming over WebSockets.

## 2. Run the Next.js Control Panel

Still under `tools/ai-automation/`, go to the `web` subfolder:

```bash
cd web
npm install
npm run dev
```

- This starts the Next.js development server on `localhost:3000`.  
- Open your browser to [http://localhost:3000](http://localhost:3000) to access the **AI Automation Control Panel**.

## 3. OpenAI Integration

If you plan to use GPT-4 or GPT-3.5:

1. **Set your API key**:  
   - Create a `.env` file in the `web` directory (or however you prefer to store secrets) with:
     ```
     OPENAI_API_KEY=YOUR_OPENAI_API_KEY
     ```
2. **Use the AI**:  
   - The control panel (or any custom page) can call the AI route (e.g. `POST /api/ai`) with a conversation or a prompt.  
   - The AI can respond with JSON specifying the script it wants to run.  
   - The front-end can then call `POST /server/api/script` to execute that code in the Puppeteer browser.

## 4. Watching the Live Browser Feed

- Once you’re at [http://localhost:3000](http://localhost:3000), you’ll see the **live screenshot stream** (updated every few seconds or via a WebSocket).
- You can optionally add UI buttons or text fields to trigger arbitrary scripts, or let the AI generate scripts automatically.

## 5. Example Workflow

1. **Launch everything**:
   - `docker run -p 4000:4000 ai-automation`  
   - `npm run dev` in `web/`.
2. **Go to**: [http://localhost:3000](http://localhost:3000).  
3. **Enter a prompt** for the AI, e.g., “Please navigate to `/signin` and log in with `user@example.com` / `myPassword123`.”  
4. The AI might return JSON containing:
   ```json
   {
     "code": "document.querySelector('#email').value = 'user@example.com'; document.querySelector('#password').value = 'myPassword123'; document.querySelector('#signin-button').click();"
   }
   ```
5. The front-end (or your code) sends this script to `POST /server/api/script`.  
6. **Watch** the browser feed update as Puppeteer enters the credentials and clicks the button.

## 6. FAQ

1. **Where does the AI logic live?**  
   - Typically, the Next.js app uses OpenAI’s API to get the AI’s script instructions, then sends them to the Puppeteer server.

2. **Can I run multiple sessions at once?**  
   - Currently, we use a **single** persistent browser. For multiple sessions, you’d need more containers or additional code to manage multiple browser instances.

3. **How do I store or replay the logs?**  
   - All console logs from the browser are printed to the Node console. You can also modify `puppeteerManager.ts` to capture logs in an array or a database.

4. **Is it secure to let the AI run arbitrary code?**  
   - **No**, not inherently. This setup prioritizes maximum power over security. Be mindful if your environment has sensitive data or production credentials.

## 7. Next Steps

- **Refine the AI prompts** so it knows about your app’s structure (login pages, selectors, etc.).  
- **Add user clarifications** if the AI asks a question, e.g., “Which user do you want to log in as?”  
- **Integrate** with your existing monorepo’s authentication or other services if needed.

---

That’s it! You now have a powerful AI-driven testing environment where the AI can fully control a real browser, stream its UI, and ask for human guidance along the way. Enjoy your **AI Automation Tool**!
