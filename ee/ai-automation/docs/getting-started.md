# Getting Started

Welcome to the **AI-Driven Automation Platform**! This comprehensive platform enables AI (GPT-4, Claude, etc.) to intelligently control web browsers with advanced capabilities including:

- 🔄 **Seamless Mode Switching**: Switch between headless and headed browser modes without losing context
- 🧠 **Intelligent UI Analysis**: Real-time UI state monitoring with component hierarchy tracking
- 📁 **Codebase Integration**: File system navigation and automation ID discovery
- 🎯 **Smart Automation**: Context-aware script execution with error recovery
- 👥 **Multi-Session Support**: Concurrent browser instances for parallel testing
- 🖥️ **Visual Control Panel**: Modern web interface for automation management

## What's New in This Release

### 🔄 Browser Session Management
- **Seamless Pop-out/Pop-in**: Switch between headless and headed modes without losing context
- **State Preservation**: Complete browser state maintained across mode transitions
- **Multi-Session Support**: Run multiple concurrent browser instances

### 🧠 Enhanced AI Integration
- **Tool-Aware AI**: AI has access to file system, UI analysis, and automation discovery tools
- **Codebase Understanding**: AI can read your code and understand application structure
- **Smart Error Recovery**: Automatic problem detection and self-correction

### 🎯 Advanced Automation Features
- **UI State Reflection**: Real-time component hierarchy tracking
- **Automation ID Discovery**: Intelligent identification of automation targets
- **Context-Aware Execution**: Scripts that understand application state

### 🖥️ Modern Control Panel
- **Visual Session Management**: Live browser monitoring with status indicators
- **Interactive AI Chat**: Enhanced conversation interface with tool integration
- **Real-time Feedback**: Instant error notifications and progress tracking

## Prerequisites

1. **Docker** installed on your machine
2. **Node.js (v18 or higher)** for running the Next.js control panel
3. **AI API Key** (OpenAI, Anthropic Claude, or compatible LLM service)
4. **Target Application** running with UI reflection system enabled
5. **Modern Browser** for accessing the control panel interface

## Repository Structure

```
tools/ai-automation/
├── Dockerfile                    # Production Docker configuration
├── Dockerfile.test              # Testing environment configuration
├── package.json                 # Server dependencies
├── tsconfig.json               # TypeScript configuration
├── src/
│   ├── index.ts                # Express server with enhanced APIs
│   ├── puppeteerManager.ts     # Browser automation engine
│   ├── browserSessionManager.ts # Session lifecycle management
│   ├── uiStateManager.ts       # UI state tracking and analysis
│   └── tools/                  # AI tool implementations
│       ├── executeScript.ts    # Script execution tools
│       ├── getUIState.ts      # UI state analysis
│       ├── readFile.ts        # File system operations
│       ├── searchAutomationIds.ts # Automation ID discovery
│       └── getNavigationHelp.ts   # UI navigation guidance
├── web/                        # Next.js Control Panel
│   ├── package.json           # Frontend dependencies
│   ├── next.config.mjs        # Next.js configuration
│   ├── src/app/
│   │   ├── page.tsx           # Main control interface
│   │   └── api/
│   │       ├── ai/route.ts    # Enhanced AI integration
│   │       └── tools/         # Tool proxy endpoints
│   └── src/tools/
│       ├── toolDefinitions.ts # AI tool specifications
│       ├── invokeTool.ts     # Tool execution logic
│       └── prompts.ts        # AI prompt templates
└── docs/
    └── getting-started.md     # This guide
```

## 1. Quick Start with Docker

### Option A: Pre-built Docker Setup

In the `tools/ai-automation` directory:

```bash
# Build the automation server
docker build --platform linux/amd64 -t ai-automation .

# Run with enhanced capabilities
docker run --rm -p 4000:4000 \
  -e NODE_ENV=development \
  -e BROWSER_MODE=headless \
  ai-automation
```

### Option B: Local Development Setup

```bash
# Install dependencies
cd ee/ai-automation
npm install

# Start the automation server
npm run dev

# Server starts on localhost:4000 with:
# ✅ Browser session management
# ✅ WebSocket UI state broadcasting  
# ✅ Enhanced tool APIs
# ✅ Multi-session support
# ✅ Real-time screenshot streaming
```

## 2. Launch the Enhanced Control Panel

Navigate to the control panel directory:

```bash
cd ee/ai-automation/web
npm install
npm run dev
```

**Control Panel Features** (http://localhost:3000):
- 🖥️ **Live Browser Stream**: Real-time screenshot with session status
- 🔄 **Mode Controls**: Pop-out/Pop-in buttons for manual intervention
- 💬 **AI Chat Interface**: Enhanced with automation tools
- 📊 **Session Dashboard**: Multi-session monitoring and management
- 🎯 **Visual Indicators**: Browser mode, session count, and connection status
- 🛠️ **Tool Integration**: Direct access to codebase analysis tools

## 3. AI Integration Setup

### Environment Configuration

Create a `.env.local` file in the `web` directory:

```bash
# AI Provider (choose one)
OPENAI_API_KEY=your_openai_key_here
# OR
ANTHROPIC_API_KEY=your_claude_key_here

# Optional: Advanced Configuration
AI_MODEL=gpt-4  # or claude-3-5-sonnet-20241022
MAX_TOKENS=4000
TEMPERATURE=0.1
AUTOMATION_SERVER_URL=http://localhost:4000
```

### Enhanced AI Capabilities

The AI now has access to powerful tools:

- **🔍 UI State Analysis**: `get_ui_state()` - Comprehensive UI component inspection
- **📁 File Operations**: `read_file()`, `find_files()`, `grep_files()` - Codebase navigation
- **🎯 Automation Discovery**: `search_automation_ids()` - Find relevant automation targets
- **🗺️ Navigation Help**: `get_navigation_help()` - UI structure guidance
- **⚡ Smart Execution**: `execute_script()` - Context-aware automation
- **👁️ Element Observation**: `observe_browser()` - Detailed element inspection

### AI Workflow Example

```typescript
// AI can now understand and automate complex workflows:
// 1. Analyze current UI state
// 2. Search codebase for automation IDs
// 3. Plan multi-step automation strategy
// 4. Execute with error recovery
// 5. Pop-out for manual intervention when needed
```

## 4. Using the Enhanced Control Panel

### Live Browser Monitoring

At [http://localhost:3000](http://localhost:3000), you'll find:

- **📸 Real-time Screenshots**: Live browser view with session context
- **🔄 Mode Indicator**: Visual status showing headless/headed mode
- **📊 Session Info**: Active session count and connection status
- **⚠️ Error Alerts**: Real-time error notifications and recovery suggestions

### Manual Intervention Controls

**Pop-out for Manual Control**:
```bash
1. Click "Pop Out Browser" button
2. Browser window appears for manual interaction
3. Complete manual tasks (login, setup, debugging)
4. Click "Pop In Browser" to return to headless automation
5. AI continues from exact same state
```

### AI Chat Integration

**Enhanced Conversation Interface**:
- 💭 **Context Awareness**: AI understands current UI state
- 🛠️ **Tool Integration**: Direct access to automation tools
- 📝 **Smart Suggestions**: AI recommends automation strategies
- 🔄 **Error Recovery**: Automatic problem detection and solutions
- 📊 **Progress Tracking**: Step-by-step automation monitoring

## 5. Example Workflows

### Workflow 1: Intelligent Company Creation

```bash
1. Start both servers (automation + control panel)
2. Navigate to http://localhost:3000
3. In AI chat, enter: "Help me create a new company in the system"

# AI automatically:
# ✅ Analyzes current UI state
# ✅ Searches for 'company' automation IDs
# ✅ Reads relevant component files
# ✅ Plans step-by-step automation
# ✅ Executes navigation and form filling
# ✅ Handles errors and validation
```

### Workflow 2: Hybrid Manual-Automatic Authentication

```bash
1. AI starts automation in headless mode
2. Encounters complex authentication (2FA, CAPTCHA)
3. AI automatically pops out browser for manual intervention
4. User completes authentication manually
5. AI pops browser back in and continues automation
6. Complete workflow seamlessly combines manual and automatic steps
```

### Workflow 3: Comprehensive Testing Suite

```bash
# AI can execute sophisticated test scenarios:
Prompt: "Run a comprehensive test of the ticket creation workflow"

# AI executes:
# 1. Navigate to tickets page
# 2. Analyze available filters and options
# 3. Create test tickets with various configurations
# 4. Validate ticket creation and data persistence
# 5. Test error scenarios and edge cases
# 6. Generate detailed test report
```

### Workflow 4: Advanced Data Operations

```bash
Prompt: "Extract all company data and create a summary report"

# AI intelligently:
# 1. Discovers company data tables
# 2. Iterates through all companies
# 3. Extracts relevant information
# 4. Handles pagination and filtering
# 5. Compiles comprehensive data export
# 6. Formats results for easy consumption
```

## 6. Advanced Features & FAQ

### Multi-Session Management

**Q: Can I run multiple browser sessions simultaneously?**

✅ **Yes!** The platform now supports concurrent browser sessions:

```bash
# Each session has a unique ID and independent state
# Perfect for parallel testing or multi-user scenarios
# Session isolation ensures no interference between tests
```

### Codebase Integration

**Q: How does the AI understand my application structure?**

🧠 **Smart Analysis**: The AI can:
- Navigate your file system
- Search for automation IDs in your codebase
- Read component implementations
- Understand UI structure and relationships
- Generate context-aware automation strategies

### State Persistence

**Q: What happens when I switch between headless and headed modes?**

🔄 **Complete State Preservation**:
- All cookies and authentication
- localStorage and sessionStorage
- Navigation history
- Form data and user inputs
- Viewport settings and user agent

### Security & Production

**Q: Is this secure for production use?**

🔒 **Configurable Security**:
- **Development**: Full access for maximum debugging capability
- **Production**: Restricted mode with limited permissions
- **Audit Logging**: Complete operation tracking
- **Session Isolation**: Secure browser context separation
- **Network Restrictions**: Localhost-only connections by default

### Error Recovery

**Q: What happens when automation fails?**

🛠️ **Intelligent Recovery**:
- Automatic error detection and classification
- Self-correction attempts using UI feedback
- Graceful fallback to manual intervention
- Detailed error reporting with suggested solutions
- Session recovery and state restoration

## 7. Next Steps & Advanced Configuration

### Optimization for Your Application

1. **Configure UI Reflection**:
   ```typescript
   // Add automation IDs to your components
   import { useAutomationIdAndRegister } from 'ui-reflection/useAutomationIdAndRegister';
   
   const { automationIdProps } = useAutomationIdAndRegister({
     id: 'my-component',
     type: 'button',
     label: 'My Button'
   });
   ```

2. **Customize AI Prompts**:
   ```typescript
   // Update web/src/tools/prompts.ts with your app-specific context
   const APP_CONTEXT = `
   This is a PSA (Professional Services Automation) system with:
   - Company/Client management
   - Ticket tracking
   - Time entry and billing
   - Project management
   `;
   ```

3. **Environment-Specific Configuration**:
   ```bash
   # Development
   BROWSER_MODE=headed
   DEBUG_MODE=true
   SLOW_MOTION=100
   
   # Production  
   BROWSER_MODE=headless
   SESSION_TIMEOUT=300000
   MAX_CONCURRENT_SESSIONS=3
   ```

### Integration with CI/CD

```yaml
# .github/workflows/e2e-automation.yml
name: E2E Automation Tests
on: [push, pull_request]

jobs:
  automation-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run AI Automation Tests
        run: |
          cd ee/ai-automation
          npm install
          npm run test:e2e
```

### Monitoring & Analytics

- **Session Metrics**: Track automation success rates
- **Performance Monitoring**: Browser resource usage
- **Error Analytics**: Common failure patterns
- **User Interaction Tracking**: Manual intervention frequency

---

🎉 **Congratulations!** You now have a state-of-the-art AI automation platform that combines:

- 🤖 **Intelligent AI Agents** with comprehensive tool access
- 🔄 **Flexible Browser Management** with seamless mode switching
- 📊 **Real-time Monitoring** with visual feedback
- 🛠️ **Codebase Integration** for context-aware automation
- 👥 **Multi-Session Support** for parallel workflows
- 🔒 **Enterprise Security** with configurable restrictions

Enjoy building the future of intelligent automation! 🚀