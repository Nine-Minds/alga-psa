# Getting Started

This guide will help you set up and run the AI automation platform for development.

## Prerequisites

- Node.js 18+
- Docker (for Kubernetes deployment)
- Target application running with UI reflection system

## Quick Start

### 1. Start the AI API Service

```bash
cd tools/ai-automation
npm install
npm run dev  # Starts on port 4000
```

This starts the automation server with:
- Browser session management
- WebSocket UI state broadcasting
- Automation tool APIs
- Real-time screenshot streaming

### 2. Start the AI Web Service

```bash
cd tools/ai-automation/web
npm install
npm run dev  # Starts on port 3000
```

This starts the control panel with:
- Live browser feed
- AI chat interface with tool integration
- Browser session controls (pop-out/pop-in)
- Real-time activity monitoring

### 3. Access the Control Panel

Open [http://localhost:3000](http://localhost:3000) to access the control panel.

## Environment Configuration

For LLM integration, you'll need to configure environment variables. The platform supports OpenRouter for accessing various LLM models.

Create a `.env` file in your home directory:

```bash
# OpenRouter configuration for LLM access
CUSTOM_OPENAI_API_KEY=sk-or-v1-your-openrouter-key
CUSTOM_OPENAI_BASE_URL=https://openrouter.ai/api/v1
CUSTOM_OPENAI_MODEL=google/gemini-flash-1.5
```

## Basic Usage

### AI Automation

1. Navigate to the control panel at `http://localhost:3000`
2. Use the chat interface to interact with the AI
3. The AI has access to automation tools for browser control and codebase analysis

Example prompt:
```
Navigate to the companies page and help me understand the UI structure
```

### Browser Session Control

- **Pop Out**: Switch to headed mode for manual intervention
- **Pop In**: Return to headless mode for continued automation
- **Status**: View current browser session information

### Available Tools

The AI can use these tools:

- `get_ui_state` - Inspect current UI state
- `observe_browser` - Get page content
- `execute_automation_script` - Run Puppeteer scripts
- `read_file` - Read files from codebase
- `search_automation_ids` - Find automation IDs
- `find_files` - Locate files by pattern

## WebSocket Events

The platform broadcasts real-time updates via WebSocket:

- `UI_STATE_UPDATE` - UI state changes
- `screenshot` - Browser screenshots
- `browser_session_update` - Session mode changes

## Development Workflow

1. Start both services (API and Web)
2. Navigate to the control panel
3. Use AI chat for intelligent automation
4. Switch browser modes as needed for manual intervention
5. Monitor real-time feedback and logs

## Docker Development

```bash
# Build AI API service
cd tools/ai-automation
docker build -t ai-automation-api .

# Build AI Web service
cd tools/ai-automation/web
docker build -t ai-automation-web .
```

## Troubleshooting

### Common Issues

1. **Port conflicts**: Ensure ports 3000 and 4000 are available
2. **WebSocket connection failed**: Check that the AI API service is running
3. **Browser session errors**: Restart the AI API service to reset browser state
4. **LLM authentication**: Verify your API keys are correctly configured

### Logs

- AI API Service logs: Check console output for automation server
- AI Web Service logs: Check Next.js console for frontend issues
- Browser session logs: Available in the control panel activity log

For more detailed troubleshooting, check the main README.md file.