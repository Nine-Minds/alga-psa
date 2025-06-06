# AI Automation Platform

The AI automation platform provides intelligent browser automation with LLM integration. It enables AI agents to interact with web applications through a comprehensive API that includes browser control, UI state monitoring, and codebase analysis.

## Architecture

```
AI Web Service (Next.js)     AI API Service (Puppeteer)
Port 3000                    Port 4000
┌─────────────────────┐     ┌──────────────────────┐
│ - Control Panel     │────▶│ - Browser Sessions   │
│ - LLM Integration   │     │ - UI State Manager   │ 
│ - Streaming Chat    │     │ - Automation Tools   │
│ - Tool Dispatch     │     │ - WebSocket Hub      │
└─────────────────────┘     └──────────────────────┘
```

The platform consists of two main services:

1. **AI Web Service** - Next.js frontend with LLM integration
2. **AI API Service** - Backend automation server with Puppeteer

## Key Features

- **Browser Session Management** - Seamless headless/headed mode switching
- **Real-time UI State Monitoring** - WebSocket-based state updates
- **LLM Tool Integration** - AI agents with automation capabilities
- **Codebase Analysis** - File system navigation and code inspection
- **Visual Feedback** - Live screenshots and session monitoring

## API Endpoints

### Browser Control
- `GET /api/browser/status` - Get current browser session status
- `POST /api/browser/pop-out` - Switch to headed mode (VNC in Kubernetes)
- `POST /api/browser/pop-in` - Switch back to headless mode

### Automation
- `GET /api/ui-state` - Get current UI state and page information
- `POST /api/puppeteer` - Execute Puppeteer automation scripts
- `POST /api/tool` - Execute specific automation tools
- `GET /api/observe` - Get current page HTML content

### LLM Integration
- `POST /api/ai` - Stream chat completions with tool access

## Available Tools

The AI has access to these automation tools:

- `get_ui_state` - Inspect current UI state
- `observe_browser` - Get page content
- `execute_script` - Run JavaScript in browser
- `execute_automation_script` - Run Puppeteer scripts
- `read_file` - Read files from codebase
- `grep_files` - Search file contents
- `find_files` - Find files by pattern
- `list_directory` - List directory contents
- `search_automation_ids` - Find automation IDs in code

## Development

### Prerequisites
- Node.js 18+
- Docker (for Kubernetes deployment)

### Local Development

1. **Start AI API Service:**
```bash
cd tools/ai-automation
npm install
npm run dev  # Starts on port 4000
```

2. **Start AI Web Service:**
```bash
cd tools/ai-automation/web
npm install
npm run dev  # Starts on port 3000
```

### Docker Build

```bash
# Build AI API service
cd tools/ai-automation
docker build -t ai-automation-api .

# Build AI Web service  
cd tools/ai-automation/web
docker build -t ai-automation-web .
```

### Environment Variables

For LLM integration, configure these in your Helm values:

```yaml
config:
  llm:
    customOpenaiApiKey: "sk-or-v1-your-openrouter-key"
    customOpenaiBaseUrl: "https://openrouter.ai/api/v1"
    customOpenaiModel: "google/gemini-flash-1.5"
```

## WebSocket Events

Connect to the WebSocket server for real-time updates:

```javascript
const socket = io('ws://localhost:4000');

// UI state updates
socket.on('UI_STATE_UPDATE', (pageState) => {
  console.log('UI state changed:', pageState);
});

// Browser screenshots
socket.on('screenshot', (base64Image) => {
  // Display live browser feed
});
```

## Usage Examples

### AI Automation
```javascript
// Chat with AI that has browser automation tools
const response = await fetch('/api/ai', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [{
      role: 'user', 
      content: 'Navigate to the companies page and add a new company'
    }]
  })
});
```

### Direct Automation
```javascript
// Execute Puppeteer script
await fetch('/api/puppeteer', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    script: `(async () => {
      await helper.navigate('http://server:3000/companies');
      await helper.click('[data-automation-id="add-company-button"]');
    })();`
  })
});
```

### Browser Session Control
```javascript
// Switch to headed mode for manual intervention
await fetch('/api/browser/pop-out', { method: 'POST' });

// Switch back to headless mode
await fetch('/api/browser/pop-in', { method: 'POST' });
```