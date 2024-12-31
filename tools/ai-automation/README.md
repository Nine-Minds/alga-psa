# AI Automation Tool

## Overview

The AI automation tool provides a bridge between LLM-driven automation and the browser, enabling automated testing and UI interaction through Puppeteer. It includes WebSocket-based UI state monitoring and screenshot streaming capabilities.

## Architecture

The server acts as a central hub connecting three main components:

```
Browser (React App) -> AI Backend Server -> External Consumers (LLM/Automation)
```

1. **Browser Application**:
   - Runs React app with UI reflection system
   - Connects via Socket.IO to broadcast UI state
   - Provides stable component IDs for automation

2. **AI Backend Server**:
   - Runs on port 4000
   - Manages WebSocket connections
   - Controls browser via Puppeteer
   - Broadcasts UI state to consumers
   - Executes automation scripts

3. **External Consumers**:
   - Connect via WebSocket to receive updates
   - Can be test harnesses, LLM agents, monitoring tools
   - Execute automation through server API

## WebSocket Capabilities

### 1. UI Reflection System

The server receives and broadcasts real-time UI state updates from the browser application:

```typescript
// Connect to receive UI state updates
const socket = io('ws://localhost:4000');

socket.on('UI_STATE_UPDATE', (pageState) => {
  console.log('UI State:', {
    pageId: pageState.id,
    title: pageState.title,
    componentCount: pageState.components.length
  });
});
```

The pageState object provides a structured view of the UI:
```typescript
interface PageState {
  id: string;          // Page identifier
  title: string;       // Page title
  components: {        // UI components
    id: string;        // Stable component ID
    type: string;      // Component type (button, dialog, etc.)
    label?: string;    // User-visible text
    disabled?: boolean;// Component state
    actions?: string[]; // Available actions
  }[];
}
```

### 2. Screenshot Streaming

The server provides real-time browser screenshots:

```javascript
const socket = io('ws://localhost:4000');

socket.on('screenshot', (base64Image) => {
  const img = document.createElement('img');
  img.src = `data:image/png;base64,${base64Image}`;
  document.body.appendChild(img);
});
```

## AI Integration

The `/api/ai` endpoint accepts prompts and returns Puppeteer scripts:

```typescript
// Send prompt to AI
const response = await fetch('/api/ai', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant that generates Puppeteer scripts'
      },
      {
        role: 'user',
        content: 'Login to the admin panel'
      }
    ]
  })
});

// Get generated script
const { reply } = await response.json();
const { code } = JSON.parse(reply);

// Execute script
await fetch('/api/script', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code })
});
```

## API Endpoints

### GET /api/observe
Returns current browser state:
```typescript
interface ObserveResponse {
  url: string;      // Current URL
  title: string;    // Page title
  html: string;     // Page HTML
}
```

### POST /api/script
Executes JavaScript in browser context:
```typescript
interface ScriptRequest {
  code: string;     // JavaScript code to execute
}
```

### POST /api/node-script
Executes Node.js code with Puppeteer access:
```typescript
interface NodeScriptRequest {
  code: string;     // Node.js code to execute
}
```

### POST /api/puppeteer
Executes Puppeteer automation script:
```typescript
interface PuppeteerRequest {
  script: string;   // Puppeteer script to execute
}
```

## WebSocket Events

### UI_STATE_UPDATE
Emitted when browser UI state changes:
```typescript
socket.on('UI_STATE_UPDATE', (pageState: PageState) => {
  // Handle UI state update
});
```

### screenshot
Emitted every 2 seconds with browser screenshot:
```typescript
socket.on('screenshot', (base64Image: string) => {
  // Handle screenshot update
});
```

## Configuration

The server runs on port 4000 with:
- WebSocket connections enabled
- CORS configured for localhost:3001
- Automatic reconnection handling
- Screenshot streaming every 2 seconds
- Puppeteer in non-headless mode for debugging

## Security Considerations

- WebSocket connections restricted to localhost
- Puppeteer runs with sandbox disabled for Docker
- Exercise caution with script execution in production
- Validate all incoming messages and scripts
- Consider adding authentication for external consumers

## Example: LLM Automation Flow

1. Connect to WebSocket for UI state:
```typescript
const socket = io('ws://localhost:4000');
socket.on('UI_STATE_UPDATE', handleUIState);
```

2. Analyze UI state with LLM:
```typescript
async function handleUIState(pageState: PageState) {
  // Generate automation based on UI state
  const prompt = generatePrompt(pageState);
  const script = await getAIScript(prompt);
  
  // Execute automation
  await executeScript(script);
}
```

3. Execute automation through API:
```typescript
async function executeScript(script: string) {
  await fetch('/api/puppeteer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script })
  });
}
```

## Contributing

1. Fork the repository
2. Create feature branch
3. Add tests
4. Submit pull request
