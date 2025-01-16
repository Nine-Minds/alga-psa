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
    console.log('Client connected');

    // Handle screenshot streaming
    const screenshotInterval = setInterval(async () => {
      try {
        const page = puppeteerManager.getPage();
        const buf = await page.screenshot();
        const base64img = Buffer.from(buf).toString('base64');
        socket.emit('screenshot', base64img);
      } catch (error) {
        console.error('Error taking screenshot', error);
      }
    }, 2000);
    
    // Track interval for cleanup
    activeIntervals.push(screenshotInterval);

    // Track previous UI state for comparison
    let previousState: any = null;

    // Handle UI reflection updates
    socket.on('UI_STATE_UPDATE', (pageState) => {
      const stateChanged = !previousState || 
        previousState.id !== pageState.id ||
        previousState.title !== pageState.title ||
        previousState.components.length !== pageState.components.length ||
        JSON.stringify(previousState.components) !== JSON.stringify(pageState.components);

      if (stateChanged) {
        console.log('Received UI state update:', {
          pageId: pageState.id,
          title: pageState.title,
          componentCount: pageState.components.length
        });
        previousState = JSON.parse(JSON.stringify(pageState)); // Deep copy to avoid reference issues
      }
      
      // Store the state in UIStateManager
      uiStateManager.updateState(pageState);
      
      // Broadcast to other clients
      socket.broadcast.emit('UI_STATE_UPDATE', pageState);
    });

    socket.on('disconnect', () => {
      const index = activeIntervals.indexOf(screenshotInterval);
      if (index > -1) {
        clearInterval(screenshotInterval);
        activeIntervals.splice(index, 1);
      }
      console.log('Client disconnected');
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
    console.log('\n[GET /api/ui-state], jsonpath:', req.query.jsonpath);
    const startTime = Date.now();
    const jsonpath = req.query.jsonpath as string | undefined;

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

      const state = uiStateManager.getCurrentState();
      if (!state) {
        throw new Error('No UI state available');
      }

      let result = state;
      if (jsonpath) {
        const { JSONPath } = await import('jsonpath-plus');
        
        console.log('state before jsonpath:', JSON.stringify(state));
        
        result = JSONPath({ path: jsonpath, json: state, ignoreEvalErrors: true, wrap: false });
      }
      
      const response = {
        ...pageInfo,
        result
      };
      
      console.log('UI state:', JSON.stringify(response));
      console.log(`Completed in ${Date.now() - startTime}ms`);
      res.json(JSON.parse(JSON.stringify(response, null, 0)));
    } catch (error) {
      console.error('Error in /api/ui-state:', error);
      console.log(`Failed in ${Date.now() - startTime}ms`);

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
      const page = puppeteerManager.getPage();
      const result = await page.evaluate(code);
      
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
    console.log('\n[POST /api/tool]');
    console.log('Request body:', req.body);
    const startTime = Date.now();

    const { toolName, args } = req.body;

    if (!toolName) {
      console.log('Error: Tool name is required');
      return res.status(400).json(JSON.parse(JSON.stringify({ error: 'Tool name is required' }, null, 0)));
    }

    try {
      const page = puppeteerManager.getPage();
      
      // Ensure tool execution is properly awaited
      let result;
      try {
        result = await toolManager.executeTool(toolName, page, args);
        // Wait for any pending promises to settle
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
      } catch (error) {
        console.error('Error executing tool:', error);
        throw error;
      }

      console.log(`Completed in ${Date.now() - startTime}ms`);
      res.json(JSON.parse(JSON.stringify({ result }, null, 0)));
    } catch (error) {
      console.error('Error executing tool:', error);
      console.log(`Failed in ${Date.now() - startTime}ms`);
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
    await puppeteerManager.init({
      headless: true,
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
