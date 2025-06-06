import express, { Request, Response, RequestHandler } from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { computeDiff } from './utils/diffUtils.js';
import { PageState } from './types/ui-reflection.js';

interface ScriptRequest {
  code: string;
}

// Module references that can be updated during reload
let puppeteerManager: any;
let toolManager: any;
let uiStateManager: any;

// Function to load/reload modules
async function loadModules() {
  const modules = await Promise.all([
    import('./puppeteerManager.js'),
    import('./tools/toolManager.js'),
    import('./uiStateManager.js')
  ]);
  
  // Update module references
  puppeteerManager = modules[0].puppeteerManager;
  toolManager = modules[1].toolManager;
  uiStateManager = modules[2].uiStateManager;
  
  // Make UIStateManager globally accessible to avoid module instance issues
  (global as any).sharedUIStateManager = uiStateManager;
}

// Create server instances
let app: express.Application = express();
let server = http.createServer(app);
let io = new Server(server, {
  cors: {
    origin: 'http://localhost:3001',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Track active intervals for cleanup
const activeIntervals: NodeJS.Timeout[] = [];

// Function to setup socket.io event handlers
function setupSocketHandlers(io: Server) {
  io.engine.on("connection", (rawSocket) => {
    try {
      if (rawSocket.setNoDelay) rawSocket.setNoDelay(true);
      if (rawSocket.setKeepAlive) rawSocket.setKeepAlive(true, 0);
    } catch (err) {
      console.error('Error configuring WebSocket:', err);
    }
  });

  // WebSocket connection handling
  io.on('connection', (socket) => {
    console.log('\x1b[47m\x1b[30m[WEBSOCKET] 🔌 Client connected\x1b[0m');

    // Handle screenshot streaming (now enabled alongside VNC for live feed)
    let screenshotInterval: NodeJS.Timeout | null = null;
    
    screenshotInterval = setInterval(async () => {
      try {
        const page = puppeteerManager.getPage();
        const buf = await page.screenshot();
        const base64img = Buffer.from(buf).toString('base64');
        socket.emit('screenshot', base64img);
      } catch (error) {
        console.error('\x1b[41m[WEBSOCKET] ❌ Error taking screenshot\x1b[0m', error);
      }
    }, 2000);
    
    // Track interval for cleanup
    if (screenshotInterval) {
      activeIntervals.push(screenshotInterval);
    }

    // Track previous UI state for comparison
    let previousState: any = null;

    // Handle UI reflection updates
    socket.on('UI_STATE_UPDATE', (pageState) => {
      console.log('\x1b[104m[WEBSOCKET] 📡 UI_STATE_UPDATE received\x1b[0m');
      
      const stateChanged = !previousState || 
        previousState.id !== pageState.id ||
        previousState.title !== pageState.title ||
        previousState.components.length !== pageState.components.length ||
        JSON.stringify(previousState.components) !== JSON.stringify(pageState.components);

      if (stateChanged) {
        console.log('\x1b[102m\x1b[30m[WEBSOCKET] ✨ UI state changed - updating stored state\x1b[0m', {
          pageId: pageState.id,
          title: pageState.title,
          componentCount: pageState.components.length
        });
        previousState = JSON.parse(JSON.stringify(pageState)); // Deep copy to avoid reference issues
      } else {
        console.log('\x1b[103m\x1b[30m[WEBSOCKET] 🔄 UI state unchanged - skipping update\x1b[0m');
      }
      
      // Store the state in UIStateManager
      console.log('\x1b[105m\x1b[30m[WEBSOCKET] 💾 Storing state in UIStateManager\x1b[0m');
      console.log('\x1b[105m\x1b[30m[WEBSOCKET] 🔍 UIStateManager instance:\x1b[0m', typeof uiStateManager, !!uiStateManager);
      uiStateManager.updateState(pageState);
      
      // Verify state was stored
      const storedState = uiStateManager.getCurrentState();
      console.log('\x1b[105m\x1b[30m[WEBSOCKET] 🔍 Verification - stored state:\x1b[0m', storedState ? {
        id: storedState.id,
        title: storedState.title,
        componentCount: storedState.components?.length || 0
      } : null);
      
      // Broadcast to other clients
      console.log('\x1b[106m\x1b[30m[WEBSOCKET] 📢 Broadcasting to other clients\x1b[0m');
      socket.broadcast.emit('UI_STATE_UPDATE', pageState);
    });

    socket.on('disconnect', () => {
      if (screenshotInterval) {
        const index = activeIntervals.indexOf(screenshotInterval);
        if (index > -1) {
          clearInterval(screenshotInterval);
          activeIntervals.splice(index, 1);
        }
      }
      console.log('\x1b[101m[WEBSOCKET] 🔌 Client disconnected\x1b[0m');
    });
  });
}

// Function to setup express middleware and routes
function setupExpress(app: express.Application) {
  app.use(cors({
    origin: 'http://localhost:3001',
    methods: ['GET', 'POST'],
    credentials: true
  }));

  app.use(express.json());

  // REST API endpoints
  app.get('/', ((_req: Request, res: Response) => {
    console.log('\n[GET /]');
    console.log('Health check request received');
    res.send('AI Automation Server Running');
    console.log('Health check response sent');
  }) as RequestHandler);

  app.get('/api/ui-state', (async (req: Request, res: Response) => {
    console.log('\x1b[45m[BACKEND] 🌐 GET /api/ui-state received\x1b[0m', { jsonpath: req.query.jsonpath });
    const startTime = Date.now();
    const jsonpath = req.query.jsonpath as string | undefined;

    try {
      console.log('\x1b[44m[BACKEND] 🎭 Getting page info from Puppeteer\x1b[0m');
      const page = puppeteerManager.getPage();
      const pageTitle = await page.title();
      const pageUrl = page.url();
      console.log(`\x1b[46m[BACKEND] 📄 Page info: "${pageTitle}" - ${pageUrl}\x1b[0m`);
      
      const pageInfo = {
        page: {
          title: pageTitle,
          url: pageUrl
        }
      };

      console.log('\x1b[43m[BACKEND] 🔄 Getting current UI state\x1b[0m');
      const state = uiStateManager.getCurrentState();
      if (!state) {
        console.error('\x1b[41m[BACKEND] ❌ No UI state available\x1b[0m');
        throw new Error('No UI state available');
      }
      console.log('\x1b[42m[BACKEND] ✅ UI state retrieved\x1b[0m', { componentCount: state.components?.length });

      let result = state;
      if (jsonpath) {
        console.log(`\x1b[35m[BACKEND] 🔍 Applying JSONPath filter: ${jsonpath}\x1b[0m`);
        const { JSONPath } = await import('jsonpath-plus');
        
        console.log('\x1b[33m[BACKEND] 📋 State before JSONPath:', JSON.stringify(state).substring(0, 200) + '...\x1b[0m');
        
        result = JSONPath({ path: jsonpath, json: state, ignoreEvalErrors: true, wrap: false });
        console.log(`\x1b[36m[BACKEND] 🎯 JSONPath result: ${Array.isArray(result) ? result.length + ' items' : typeof result}\x1b[0m`);
      }
      
      const response = {
        ...pageInfo,
        result
      };
      
      console.log(`\x1b[32m[BACKEND] ✅ Sending response - completed in ${Date.now() - startTime}ms\x1b[0m`);
      res.json(JSON.parse(JSON.stringify(response, null, 0)));
    } catch (error) {
      console.error(`\x1b[41m[BACKEND] ❌ Error in /api/ui-state: ${error}\x1b[0m`);
      console.log(`\x1b[91m[BACKEND] 💥 Failed in ${Date.now() - startTime}ms\x1b[0m`);

      // Get page info even for error responses
      try {
        const page = puppeteerManager.getPage();
        const pageTitle = await page.title();
        const pageUrl = page.url();
        const pageInfo = {
          page: {
            title: pageTitle,
            url: pageUrl
          }
        };

        res.status(500).json(JSON.parse(JSON.stringify({
          ...pageInfo,
          error: error instanceof Error ? error.message : String(error)
        }, null, 0)));
      } catch (pageError) {
        // If we can't get page info, just return the original error
        res.status(500).json(JSON.parse(JSON.stringify({
          error: error instanceof Error ? error.message : String(error)
        }, null, 0)));
      }
    }
  }) as RequestHandler);

  app.get('/api/observe', (async (req: Request, res: Response) => {
    console.log('\n[GET /api/observe]');
    console.log('Query params:', req.query);
    const startTime = Date.now();

    try {
      const page = puppeteerManager.getPage();
      const title = await page.title();
      const url = page.url();
      
      let html: string;
      if (req.query.selector) {
        // If selector is provided, get HTML only for matching elements
        const elements = await page.$$(req.query.selector as string);
        const elementHtmls = await Promise.all(elements.map((el: any) => page.evaluate((el: any) => el.outerHTML, el)));
        html = elementHtmls.join('\n');
      } else {
        // If no selector, get full page HTML
        html = await page.content();
      }
      
      const response = { url, title, html };
      console.log('Response:', { 
        url, 
        title, 
        htmlLength: html.length,
        selector: req.query.selector || 'none'
      });
      console.log(`Completed in ${Date.now() - startTime}ms`);
      res.json(JSON.parse(JSON.stringify(response, null, 0)));
    } catch (err) {
      console.error('Error in /api/observe:', err);
      console.log(`Failed in ${Date.now() - startTime}ms`);
      res.status(500).json(JSON.parse(JSON.stringify({
        error: err instanceof Error ? err.message : String(err)
      }, null, 0)));
    }
  }) as RequestHandler);

  app.post('/api/script', (async (req: Request<{}, any, ScriptRequest>, res: Response) => {
    console.log('\n[POST /api/script]');
    console.log('Request body:', req.body);
    const startTime = Date.now();

    const { code } = req.body;
    if (!code) {
      console.log('Error: No code provided');
      return res.status(400).json(JSON.parse(JSON.stringify({ error: 'No code provided.' }, null, 0)));
    }

    try {
      const result = await puppeteerManager.execute_automation_script(code);
      
      console.log('Script result:', result);
      console.log(`Completed in ${Date.now() - startTime}ms`);
      res.json(JSON.parse(JSON.stringify({ result }, null, 0)));
    } catch (err) {
      console.error('Error in /api/script:', err);
      console.log(`Failed in ${Date.now() - startTime}ms`);
      res.status(500).json(JSON.parse(JSON.stringify({ error: String(err) }, null, 0)));
    }
  }) as RequestHandler);

  app.post('/api/node-script', (async (req: Request<{}, any, ScriptRequest>, res: Response) => {
    console.log('\n[POST /api/node-script]');
    console.log('Request body:', req.body);
    const startTime = Date.now();

    const { code } = req.body;
    try {
      const fn = new Function('require', 'page', code);
      const page = puppeteerManager.getPage();
      const result = await fn(require, page);
      
      console.log('Node script result:', result);
      console.log(`Completed in ${Date.now() - startTime}ms`);
      res.json(JSON.parse(JSON.stringify({ result }, null, 0)));
    } catch (err) {
      console.error('Error in /api/node-script:', err);
      console.log(`Failed in ${Date.now() - startTime}ms`);
      res.status(500).json(JSON.parse(JSON.stringify({ error: String(err) }, null, 0)));
    }
  }) as RequestHandler);

  app.post('/api/puppeteer', (async (req: Request, res: Response) => {
    console.log('\n[POST /api/puppeteer]');
    console.log('Request body:', req.body);
    const startTime = Date.now();

    // Default empty state that matches PageState type
    const emptyState: PageState = {
      id: 'empty',
      title: 'Empty State',
      components: []
    };

    // Get the OLD state before running the script
    const oldState = JSON.parse(JSON.stringify(uiStateManager.getCurrentState() ?? emptyState));

    try {
      const { script } = req.body;
      console.log('Script:', script);
      if (!script) {
        console.log('Error: Script is required');
        return res.status(400).json(JSON.parse(JSON.stringify({ error: 'Script is required' }, null, 0)));
      }

      const page = puppeteerManager.getPage();

      // Ensure script execution is properly awaited
      let result;
      try {
        result = await toolManager.executeTool('execute_automation_script', page, { script });
        // Wait for any pending promises to settle and UI updates to propagate
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 200)));
      } catch (error) {
        console.error('Error executing puppeteer script:', error);
        throw error;
      }

      // Get the NEW state after script execution
      const newState = uiStateManager.getCurrentState() ?? emptyState;

      // Compute the diff
      const diff = await computeDiff(oldState, newState);
      
      console.log('Puppeteer script result:', result);
      console.log(`Completed in ${Date.now() - startTime}ms`);
      
      // Send response with script result, diff, and new state
      res.json(JSON.parse(JSON.stringify({
        status: 'success',
        scriptResult: result || {},
        diff
      }, null, 0)));
    } catch (error) {
      console.error('Error in /api/puppeteer:', error);
      console.log(`Failed in ${Date.now() - startTime}ms`);

      // Even on error, get the new state and compute diff
      const newState = uiStateManager.getCurrentState() ?? emptyState;
      const diff = await computeDiff(oldState, newState);

      res.status(500).json(JSON.parse(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        diff
      }, null, 0)));
    }
  }) as RequestHandler);

  app.post('/api/tool', (async (req: Request, res: Response) => {
    console.log('\x1b[103m\x1b[30m[BACKEND] 🛠️ POST /api/tool received\x1b[0m');
    const { toolName, args } = req.body;
    console.log(`\x1b[46m[BACKEND] 🔧 Tool: ${toolName}\x1b[0m`, { args });
    const startTime = Date.now();

    if (!toolName) {
      console.error('\x1b[41m[BACKEND] ❌ Tool name is required\x1b[0m');
      return res.status(400).json(JSON.parse(JSON.stringify({ error: 'Tool name is required' }, null, 0)));
    }

    try {
      console.log('\x1b[44m[BACKEND] 🎭 Getting Puppeteer page\x1b[0m');
      const page = puppeteerManager.getPage();
      
      // Ensure tool execution is properly awaited
      let result;
      try {
        console.log(`\x1b[45m[BACKEND] 🚀 Executing tool: ${toolName}\x1b[0m`);
        result = await toolManager.executeTool(toolName, page, args);
        console.log('\x1b[43m\x1b[30m[BACKEND] ⏱️ Waiting for promises to settle\x1b[0m');
        // Wait for any pending promises to settle
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
      } catch (error) {
        console.error('\x1b[41m[BACKEND] ❌ Error executing tool:\x1b[0m', error);
        throw error;
      }

      console.log(`\x1b[32m[BACKEND] ✅ Tool execution completed in ${Date.now() - startTime}ms\x1b[0m`);
      res.json(JSON.parse(JSON.stringify({ result }, null, 0)));
    } catch (error) {
      console.error('\x1b[41m[BACKEND] ❌ Tool execution failed:\x1b[0m', error);
      console.log(`\x1b[91m[BACKEND] 💥 Failed in ${Date.now() - startTime}ms\x1b[0m`);
      res.status(500).json(JSON.parse(JSON.stringify({ 
        error: error instanceof Error ? error.message : String(error)
      }, null, 0)));
    }
  }) as RequestHandler);

  // Browser session management endpoints
  app.post('/api/browser/pop-out', (async (req: Request, res: Response) => {
    console.log('\x1b[105m\x1b[30m[BACKEND] 🪟 POST /api/browser/pop-out received\x1b[0m');
    const startTime = Date.now();

    // Check if we're in a Kubernetes environment
    if (process.env.KUBERNETES_SERVICE_HOST || process.env.ALGA_DEV_ENV === 'true') {
      console.log('\x1b[43m[BACKEND] ⚠️ Redirecting to VNC viewer for Kubernetes environment\x1b[0m');
      res.json({
        status: 'vnc',
        message: 'Opening VNC viewer for browser control',
        vncUrl: '/vnc',
        suggestion: 'The browser will open in a VNC viewer where you can see and control it.'
      });
      return;
    }

    try {
      const result = await puppeteerManager.popOut();
      console.log(`\x1b[32m[BACKEND] ✅ Browser popped out successfully in ${Date.now() - startTime}ms\x1b[0m`);
      res.json(JSON.parse(JSON.stringify({
        status: 'success',
        message: 'Browser popped out to headed mode',
        ...result
      }, null, 0)));
    } catch (error) {
      console.error('\x1b[41m[BACKEND] ❌ Error popping out browser:\x1b[0m', error);
      console.log(`\x1b[91m[BACKEND] 💥 Failed in ${Date.now() - startTime}ms\x1b[0m`);
      res.status(500).json(JSON.parse(JSON.stringify({
        error: error instanceof Error ? error.message : String(error)
      }, null, 0)));
    }
  }) as RequestHandler);

  app.post('/api/browser/pop-in', (async (req: Request, res: Response) => {
    console.log('\x1b[105m\x1b[30m[BACKEND] 🔍 POST /api/browser/pop-in received\x1b[0m');
    const startTime = Date.now();

    try {
      const result = await puppeteerManager.popIn();
      console.log(`\x1b[32m[BACKEND] ✅ Browser popped in successfully in ${Date.now() - startTime}ms\x1b[0m`);
      res.json(JSON.parse(JSON.stringify({
        status: 'success',
        message: 'Browser popped in to headless mode',
        ...result
      }, null, 0)));
    } catch (error) {
      console.error('\x1b[41m[BACKEND] ❌ Error popping in browser:\x1b[0m', error);
      console.log(`\x1b[91m[BACKEND] 💥 Failed in ${Date.now() - startTime}ms\x1b[0m`);
      res.status(500).json(JSON.parse(JSON.stringify({
        error: error instanceof Error ? error.message : String(error)
      }, null, 0)));
    }
  }) as RequestHandler);

  // Simple health check endpoint
  app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // VNC debug routes
  app.use('/api/vnc', (async (req: Request, res: Response, next: any) => {
    try {
      const vncDebug = await import('./routes/vnc-debug.js');
      vncDebug.default(req, res, next);
    } catch (error) {
      console.error('Error loading VNC debug routes:', error);
      res.status(500).json({ error: 'VNC debug routes not available' });
    }
  }) as RequestHandler);

  app.get('/api/browser/status', (async (req: Request, res: Response) => {
    console.log('\x1b[104m\x1b[30m[BACKEND] 📊 GET /api/browser/status received\x1b[0m');
    const startTime = Date.now();

    try {
      const status = puppeteerManager.getSessionStatus();
      console.log(`\x1b[32m[BACKEND] ✅ Browser status retrieved in ${Date.now() - startTime}ms\x1b[0m`);
      res.json(JSON.parse(JSON.stringify(status, null, 0)));
    } catch (error) {
      console.error('\x1b[41m[BACKEND] ❌ Error getting browser status:\x1b[0m', error);
      console.log(`\x1b[91m[BACKEND] 💥 Failed in ${Date.now() - startTime}ms\x1b[0m`);
      res.status(500).json(JSON.parse(JSON.stringify({
        error: error instanceof Error ? error.message : String(error)
      }, null, 0)));
    }
  }) as RequestHandler);
}

// Start server
const PORT = process.env.PORT || 4000;

// Function to cleanup server resources
async function cleanupServer() {
  console.log('Cleaning up server resources...');
  
  // Clear all active intervals
  activeIntervals.forEach(interval => clearInterval(interval));
  activeIntervals.length = 0;
  
  // Close HTTP server and socket.io
  await new Promise<void>((resolve) => {
    io.close(() => {
      server.close(() => {
        console.log('HTTP and WebSocket servers closed');
        resolve();
      });
    });
  });
  
  // Close Puppeteer
  console.log('Closing Puppeteer...');
  await puppeteerManager.close();
  console.log('Puppeteer closed successfully');
}

// Function to reload the server
async function reloadServer() {
  console.log('\n[Server Reload] Reloading server...');
  
  // Cleanup existing resources
  await cleanupServer();
  
  try {
    // Load fresh versions of modules
    await loadModules();
    
    // Create new server instances
    app = express();
    server = http.createServer(app);
    io = new Server(server, {
      cors: {
        origin: 'http://localhost:3001',
        methods: ['GET', 'POST'],
        credentials: true
      }
    });
    
    // Setup express and socket.io handlers
    setupExpress(app);
    setupSocketHandlers(io);
    
    // Restart server components
    console.log('Restarting server components...');
    await startServer();
    console.log('Server reload complete with fresh module imports');
  } catch (error) {
    console.error('Error during reload:', error);
    process.exit(1);
  }
}

// Handle process cleanup and reload
process.on('SIGUSR1', async () => {
  console.log('\n[Server Reload] Received SIGUSR1 signal [SKIPPED]');
  // await reloadServer();
});

process.on('SIGTERM', async () => {
  console.log('\n[Server Shutdown] Received SIGTERM signal');
  await cleanupServer();
  console.log('Server shutdown complete');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n[Server Shutdown] Received SIGINT signal');
  await cleanupServer();
  console.log('Server shutdown complete');
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Initialize server
async function startServer() {
  console.log('Starting server initialization...');
  
  try {
    console.log('Initializing Puppeteer...');
    // Use headed mode when VNC is enabled for visual debugging
    const useHeadedMode = process.env.VNC_ENABLED === 'true';
    console.log(`VNC_ENABLED: ${process.env.VNC_ENABLED}, using headed mode: ${useHeadedMode}`);
    
    await puppeteerManager.init({
      headless: !useHeadedMode,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    }, 5);

    console.log('Verifying Puppeteer initialization...');
    if (!puppeteerManager.getPage()) {
      throw new Error('Puppeteer failed to initialize - no page available');
    }

    console.log('Starting HTTP server...');
    await new Promise<void>((resolve, reject) => {
      server.listen(PORT, () => {
        console.log('\n=== AI Automation Server Initialized ===');
        console.log(`- Process ID: ${process.pid}`);
        console.log(`- HTTP/WebSocket server running on port ${PORT}`);
        console.log('- Puppeteer initialized successfully');
        console.log('- CORS enabled for localhost:3001');
        console.log('- WebSocket screenshot streaming ready');
        console.log('- All API endpoints registered');
        console.log('========================================\n');
        resolve();
      });

      server.on('error', (err) => {
        reject(new Error(`Failed to start server: ${err.message}`));
      });
    });
  } catch (error) {
    console.error('Server initialization failed:', error);
    await cleanupServer();
    process.exit(1);
  }
}

// Initial setup
setupExpress(app);
setupSocketHandlers(io);

// Initial module load
await loadModules();

startServer().catch((error) => {
  console.error('Fatal error during server startup:', error);
  process.exit(1);
});
