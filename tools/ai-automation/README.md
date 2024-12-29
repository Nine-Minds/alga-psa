# AI Automation Tool

## AI Integration

The AI endpoint allows for generating Puppeteer scripts using Anthropic's Claude model. Here's how it works:

1. **Sending Prompts to AI**
   - POST requests to `/api/ai` with the following structure:
     ```json
     {
       "messages": [
         {"role": "system", "content": "You are a helpful assistant that generates Puppeteer scripts"},
         {"role": "user", "content": "Login to the admin panel"}
       ]
     }
     ```

2. **AI Response Handling**
   - The AI returns generated code in the response:
     ```json
     {
       "reply": "{\"code\": \"await page.goto('https://example.com/login'); await page.type('#username', 'admin'); await page.type('#password', 'password'); await page.click('#login-btn');\"}"
     }
     ```

3. **Executing the Script**
   - The returned code can be sent to `/server/api/script` for execution in the Puppeteer environment.

### Example Flow
1. Frontend sends prompt to `/api/ai`
2. AI generates Puppeteer script
3. Frontend receives and parses the response
4. Frontend sends the generated code to `/server/api/script`
5. Puppeteer executes the script and streams results back

## Persistent Puppeteer Session

The server maintains a persistent Puppeteer browser instance that
- Launches automatically on server startup
- Maintains state (cookies, session) across multiple commands
- Can be accessed via the `puppeteerManager` instance

### Usage

The browser instance is automatically initialized when the server starts. You can access the current page using:

```typescript
import { puppeteerManager } from './puppeteerManager';

const page = puppeteerManager.getPage();
```

### API Endpoints

#### GET /api/observe

Returns the current state of the browser page including:
- URL
- Page title
- HTML content

Example response:
```json
{
  "url": "https://example.com",
  "title": "Example Domain",
  "html": "<html>...</html>"
}
```

#### POST /api/script

Executes arbitrary JavaScript code in the browser context.

Request body:
```json
{
  "code": "document.querySelector('#login').click();"
}

Response:
```json
{
  "result": "return value from the executed code"
}
```

#### POST /api/node-script

Executes arbitrary Node.js code in the server context with access to Puppeteer.

Request body:
```json
{
  "code": "await page.goto('https://example.com');"
}

Response:
```json
{
  "result": "return value from the executed code"
}
```

**Warning:** Both script endpoints allow execution of arbitrary code. Use with extreme caution in production environments.

### WebSocket Streaming

The server provides real-time browser streaming via WebSockets. Clients can connect to:

```
ws://localhost:4000
```

Once connected, the server will emit 'screenshot' events every 2 seconds containing base64-encoded PNG images of the browser viewport.

Example client connection:

```javascript
const socket = new WebSocket('ws://localhost:4000');

socket.addEventListener('message', (event) => {
  const img = document.createElement('img');
  img.src = `data:image/png;base64,${event.data}`;
  document.body.appendChild(img);
});
```

### Shutdown

The browser will automatically close when the server process exits. To manually close the browser:

```typescript
await puppeteerManager.close();
```

### Configuration

The browser is launched with the following options:
- `headless: false` - Runs in non-headless mode for debugging
- `args: ['--no-sandbox']` - Required for Docker compatibility
