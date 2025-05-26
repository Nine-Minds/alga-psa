# AI Automation Platform

## Overview

The AI automation platform provides a comprehensive bridge between LLM-driven automation and browser interaction, enabling intelligent testing and UI automation through Puppeteer. It features advanced session management, real-time UI state monitoring, codebase analysis tools, and seamless manual intervention capabilities.

## Architecture

The platform acts as a central hub connecting multiple components with advanced capabilities:

```
Target App (React) -> AI Backend Server -> Control Panel (Next.js) -> External Consumers (LLM/Automation)
                 \                      /
                  WebSocket Connection
```

1. **Target Application**:
   - Runs React app with UI reflection system
   - Connects via Socket.IO to broadcast UI state
   - Provides stable automation IDs for components
   - Implements smart component registration system

2. **AI Backend Server**:
   - Runs on port 4000
   - **Browser Session Management**: Seamless headless/headed mode switching
   - **WebSocket Hub**: Real-time state broadcasting
   - **Codebase Analysis**: File system navigation and code inspection
   - **Smart Automation**: UI-aware script execution with context
   - **Multi-Session Support**: Concurrent browser instances

3. **Control Panel (Next.js)**:
   - Visual automation interface on port 3000
   - Live browser screenshot streaming
   - Manual intervention controls (pop-out/pop-in)
   - AI chat interface with tool integration
   - Session status monitoring

4. **External Consumers**:
   - Connect via WebSocket for real-time updates
   - LLM agents with enhanced tool access
   - Test harnesses with codebase awareness
   - Monitoring tools with session insights

## Key Features

### 1. Browser Session Management

**Seamless Mode Switching**: Switch between headless and headed browser modes without losing context:

```typescript
// Pop out to headed mode for manual intervention
POST /api/browser/pop-out

// Pop back in to headless mode to continue automation  
POST /api/browser/pop-in

// Check current session status
GET /api/browser/status
```

**State Preservation**: Complete browser state maintained across transitions:
- Cookies and authentication
- localStorage and sessionStorage
- Navigation history
- Viewport settings
- User agent configuration

### 2. Enhanced UI Reflection System

Advanced UI state monitoring with component hierarchy tracking:

```typescript
// Connect to receive UI state updates
const socket = io('ws://localhost:4000');

socket.on('UI_STATE_UPDATE', (pageState) => {
  console.log('Enhanced UI State:', {
    pageId: pageState.id,
    title: pageState.title,
    componentCount: pageState.components.length,
    hierarchy: pageState.componentHierarchy,
    registeredComponents: pageState.registeredComponents
  });
});
```

**Comprehensive Component Data**:
```typescript
interface PageState {
  id: string;                    // Page identifier
  title: string;                 // Page title
  url: string;                   // Current URL
  components: UIComponent[];     // Flat component list
  componentHierarchy: ComponentTree; // Nested structure
  registeredComponents: number;  // Total registered count
  automationMetadata: {          // Automation-specific data
    actionableElements: number;
    formsAvailable: string[];
    navigationOptions: string[];
  };
}

interface UIComponent {
  id: string;                    // Stable automation ID
  type: string;                  // Component type
  label?: string;                // User-visible text
  disabled?: boolean;            // Component state
  actions?: string[];            // Available actions
  parentId?: string;             // Parent component ID
  metadata?: Record<string, any>; // Additional component data
  automationContext?: {          // Automation hints
    role: string;
    ariaLabel?: string;
    dataTestId?: string;
  };
}
```

### 3. Intelligent Codebase Analysis

**File System Navigation**:
```typescript
// Search for files by pattern
POST /api/tools/find_files
{
  "pattern": "*.tsx",
  "directory": "server/src/components"
}

// Read file contents
POST /api/tools/read_file
{
  "filePath": "server/src/components/companies/Companies.tsx"
}

// Search file contents
POST /api/tools/grep_files
{
  "pattern": "useAutomationIdAndRegister",
  "filePattern": "*.tsx"
}
```

**Automation ID Discovery**:
```typescript
// Find automation IDs in codebase
POST /api/tools/search_automation_ids
{
  "searchTerm": "company",
  "directory": "server/src/components/companies"
}

// Get navigation help for UI structure
POST /api/tools/get_navigation_help
{
  "context": "company management"
}
```

### 4. Advanced Screenshot Streaming

Real-time visual feedback with session awareness:

```typescript
const socket = io('ws://localhost:4000');

// Enhanced screenshot data
socket.on('screenshot', (screenshotData) => {
  const { 
    base64Image, 
    sessionId, 
    mode, 
    timestamp, 
    viewport 
  } = screenshotData;
  
  // Display with session context
  updateScreenshotDisplay(base64Image, {
    session: sessionId,
    browserMode: mode, // 'headless' or 'headed'
    capturedAt: timestamp,
    dimensions: viewport
  });
});
```

## Enhanced AI Integration

**Multi-Tool AI Agent**: The AI has access to comprehensive automation tools:

```typescript
// Enhanced AI interaction with tool access
const response = await fetch('/api/ai', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [
      {
        role: 'system',
        content: `You are an intelligent UI automation assistant with access to:
        - Browser control and observation
        - Codebase analysis and navigation
        - UI state inspection
        - File system operations
        - Automation ID discovery
        Use these tools to understand the application structure before automating.`
      },
      {
        role: 'user',
        content: 'Help me automate adding a new company in the system'
      }
    ]
  })
});

// AI can now use tools like:
// 1. get_ui_state() - Understand current UI
// 2. search_automation_ids("company") - Find relevant automation IDs
// 3. read_file("Companies.tsx") - Understand component structure
// 4. execute_script() - Perform automation
```

**Intelligent Automation Workflow**:
1. **Context Discovery**: AI analyzes UI state and codebase
2. **Strategy Planning**: Identifies automation approach
3. **Progressive Execution**: Step-by-step automation with validation
4. **Error Recovery**: Self-correction using UI feedback
5. **Manual Handoff**: Pop-out for human intervention when needed
```

## API Endpoints

### Browser Session Management

#### POST /api/browser/pop-out
Switch to headed mode for manual intervention:
```typescript
interface PopOutResponse {
  success: boolean;
  sessionId: string;
  mode: 'headed';
  message: string;
}
```

#### POST /api/browser/pop-in  
Return to headless mode:
```typescript
interface PopInResponse {
  success: boolean;
  sessionId: string;
  mode: 'headless';
  message: string;
}
```

#### GET /api/browser/status
Get current session information:
```typescript
interface BrowserStatus {
  sessionId: string;
  mode: 'headless' | 'headed';
  url: string;
  title: string;
  activeSessions: number;
  uptime: number;
}
```

### Enhanced Automation

#### GET /api/ui-state
Get comprehensive UI state:
```typescript
interface UIStateResponse {
  pageState: PageState;
  componentCount: number;
  automationCapabilities: string[];
  lastUpdate: string;
}
```

#### POST /api/tools/{toolName}
Execute automation tools:
```typescript
// Available tools:
// - get_ui_state
// - read_file
// - grep_files  
// - find_files
// - list_directory
// - search_automation_ids
// - get_navigation_help
// - observe_browser
// - execute_script
// - execute_automation_script
```

### Legacy Endpoints (Still Supported)

#### GET /api/observe
Basic browser state (legacy):
```typescript
interface ObserveResponse {
  url: string;
  title: string;
  html: string;
}
```

#### POST /api/script
Execute JavaScript in browser:
```typescript
interface ScriptRequest {
  code: string;
}
```

#### POST /api/puppeteer
Execute Puppeteer automation:
```typescript
interface PuppeteerRequest {
  script: string;
}
```

## WebSocket Events

### UI_STATE_UPDATE
Emitted when UI state changes with enhanced data:
```typescript
socket.on('UI_STATE_UPDATE', (enhancedPageState: EnhancedPageState) => {
  const {
    pageState,
    componentHierarchy,
    automationMetadata,
    registrationStats
  } = enhancedPageState;
  
  // Handle comprehensive UI update
});
```

### screenshot
Emitted with session context:
```typescript
socket.on('screenshot', (screenshotData: ScreenshotData) => {
  const {
    base64Image,
    sessionId,
    mode,
    timestamp,
    viewport
  } = screenshotData;
  
  // Handle screenshot with session awareness
});
```

### browser_session_update
Emitted when browser session changes mode:
```typescript
socket.on('browser_session_update', (sessionUpdate: SessionUpdate) => {
  const {
    sessionId,
    previousMode,
    currentMode,
    statePreserved,
    timestamp
  } = sessionUpdate;
  
  // Handle mode transition
});
```

## Configuration

### Server Configuration (Port 4000)
- **Multi-Session Support**: Concurrent browser instances
- **WebSocket Hub**: Real-time state broadcasting
- **CORS**: Configured for localhost:3000 (Control Panel)
- **Session Management**: Automatic cleanup and recovery
- **Screenshot Streaming**: Configurable interval (default 2 seconds)
- **Browser Modes**: Dynamic headless/headed switching

### Control Panel Configuration (Port 3000)
- **Next.js Interface**: Modern React-based control panel
- **Real-time Updates**: Live session monitoring
- **AI Integration**: Enhanced tool-aware chat interface
- **Visual Controls**: Pop-out/pop-in browser management
- **Session Dashboard**: Multi-session status overview

### Browser Launch Options
```typescript
// Headless Mode
{
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage'
  ]
}

// Headed Mode (Pop-out)
{
  headless: false,
  args: [
    '--window-size=1900,1200',
    '--disable-web-security',
    '--disable-features=VizDisplayCompositor'
  ]
}
```

## Security Considerations

### Network Security
- **WebSocket Restrictions**: Localhost-only connections
- **CORS Policy**: Strict origin validation
- **API Authentication**: Token-based access control (planned)

### Browser Security
- **Sandbox Management**: Controlled sandbox disabling for Docker
- **Script Validation**: Input sanitization for all executed code
- **Session Isolation**: Separate browser contexts per session
- **State Protection**: Secure storage of session data

### Production Readiness
- **Environment Detection**: Automatic security adjustments
- **Audit Logging**: Comprehensive operation tracking
- **Error Handling**: Graceful failure recovery
- **Resource Limits**: Memory and CPU usage controls

### Development vs Production
```typescript
// Development (Permissive)
{
  headless: false,
  devtools: true,
  slowMo: 100
}

// Production (Secured)
{
  headless: true,
  devtools: false,
  timeout: 30000,
  resourceLimits: {
    maxMemory: '512MB',
    maxCPU: '50%'
  }
}
```

## Example: Enhanced Automation Workflows

### 1. Intelligent UI Discovery
```typescript
const socket = io('ws://localhost:4000');

// Enhanced UI state handling
socket.on('UI_STATE_UPDATE', async (enhancedState) => {
  const { pageState, automationMetadata } = enhancedState;
  
  // AI analyzes UI with context
  const analysis = await analyzeUIWithContext({
    currentState: pageState,
    availableActions: automationMetadata.actionableElements,
    navigationOptions: automationMetadata.navigationOptions,
    codebaseContext: await getCodebaseContext(pageState.url)
  });
  
  // Execute intelligent automation
  await executeIntelligentAutomation(analysis);
});
```

### 2. Hybrid Manual-Automatic Workflow
```typescript
async function hybridAutomationWorkflow() {
  // Start in headless mode
  await startAutomation();
  
  try {
    // Attempt automated login
    await automateLogin();
  } catch (authenticationError) {
    // Pop out for manual intervention
    await fetch('/api/browser/pop-out', { method: 'POST' });
    
    // Wait for user to complete authentication
    await waitForUserCompletion('Please complete login manually');
    
    // Pop back in to continue automation
    await fetch('/api/browser/pop-in', { method: 'POST' });
    
    // Continue with automated workflow
    await continueAutomation();
  }
}
```

### 3. Codebase-Aware Automation
```typescript
async function codebseAwareAutomation(task: string) {
  // Analyze codebase for automation opportunities
  const automationIds = await searchAutomationIds(task);
  const relevantComponents = await findRelevantComponents(task);
  const navigationStructure = await getNavigationHelp(task);
  
  // Generate context-aware automation
  const automationPlan = await generateAutomationPlan({
    task,
    automationIds,
    components: relevantComponents,
    navigation: navigationStructure,
    currentUIState: await getCurrentUIState()
  });
  
  // Execute with error recovery
  await executeWithRecovery(automationPlan);
}
```

### 4. Multi-Session Management
```typescript
class AutomationOrchestrator {
  private sessions: Map<string, BrowserSession> = new Map();
  
  async createTestSession(testSuite: string) {
    const sessionId = await this.createSession(`test-${testSuite}`);
    return sessionId;
  }
  
  async runParallelTests(testSuites: string[]) {
    const sessions = await Promise.all(
      testSuites.map(suite => this.createTestSession(suite))
    );
    
    // Run tests in parallel across sessions
    const results = await Promise.all(
      sessions.map(sessionId => this.runTestSuite(sessionId))
    );
    
    return this.aggregateResults(results);
  }
}
```

## Advanced Use Cases

### 1. Dynamic Form Automation
- **Smart Field Detection**: Automatic form field discovery
- **Validation Handling**: Error detection and correction
- **Multi-Step Forms**: Navigation between form pages
- **Data Persistence**: Form state preservation across sessions

### 2. Testing & QA Automation
- **Visual Regression Testing**: Screenshot-based comparisons
- **Cross-Browser Testing**: Multi-session browser testing
- **User Journey Testing**: End-to-end workflow validation
- **Performance Monitoring**: Automated performance metrics

### 3. Data Extraction & Migration
- **Intelligent Scraping**: Context-aware data extraction
- **Form Population**: Automated data entry from external sources
- **Report Generation**: Automated report creation and export
- **System Integration**: Cross-platform data synchronization

### 4. Training & Documentation
- **Interactive Tutorials**: Step-by-step user guidance
- **Workflow Recording**: Automation script generation from manual actions
- **Documentation Generation**: Automatic UI documentation creation
- **User Onboarding**: Guided product tours and setup

## Development & Deployment

### Local Development
```bash
# Start automation server
cd tools/ai-automation
npm run dev

# Start control panel
cd web
npm run dev

# Docker development
docker build -t ai-automation .
docker run -p 4000:4000 ai-automation
```

### Production Deployment
```bash
# Build production images
docker build -f Dockerfile.prod -t ai-automation:prod .

# Deploy with Docker Compose
docker-compose -f docker-compose.prod.yaml up -d

# Health checks
curl http://localhost:4000/api/browser/status
```

### Environment Configuration
```bash
# Required environment variables
OPENAI_API_KEY=your_openai_key_here
NODE_ENV=production
BROWSER_MODE=headless
SESSION_TIMEOUT=1800000
MAX_SESSIONS=5
```

## Contributing

1. **Fork the repository**
2. **Create feature branch**: `git checkout -b feature/amazing-feature`
3. **Add comprehensive tests**: Unit, integration, and E2E tests
4. **Update documentation**: README, API docs, and inline comments
5. **Submit pull request**: With detailed description and test results

### Development Guidelines
- **TypeScript First**: All new code must be TypeScript
- **Test Coverage**: Minimum 80% code coverage required
- **API Documentation**: OpenAPI specs for all endpoints
- **Security Review**: Security implications for all changes
- **Performance Testing**: Load testing for session management features
