import express, { Request, Response, RequestHandler } from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { puppeteerManager } from './puppeteerManager';
import { toolManager } from './tools/toolManager';
import { uiStateManager } from './uiStateManager';

interface ScriptRequest {
  code: string;
}

const app: express.Application = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3001',
    methods: ['GET', 'POST'],
    credentials: true
  }
});
io.engine.on("connection", (rawSocket) => {
  try {
    if (rawSocket.setNoDelay) rawSocket.setNoDelay(true);
    if (rawSocket.setKeepAlive) rawSocket.setKeepAlive(true, 0);
  } catch (err) {
    console.error('Error configuring WebSocket:', err);
  }
});

app.use(cors({
  origin: 'http://localhost:3001',
  methods: ['GET', 'POST'],
  credentials: true
}));

// const io = new Server(server, {
//   cors: {
//     origin: 'http://localhost:3001',
//     methods: ['GET', 'POST'],
//     credentials: true
//   }
// });
app.use(express.json());

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

  // Handle UI reflection updates
  socket.on('UI_STATE_UPDATE', (pageState) => {
    console.log('Received UI state update:', {
      pageId: pageState.id,
      title: pageState.title,
      componentCount: pageState.components.length
    });
    
    // Store the state in UIStateManager
    uiStateManager.updateState(pageState);
    
    // Broadcast to other clients
    socket.broadcast.emit('UI_STATE_UPDATE', pageState);
  });

  socket.on('disconnect', () => {
    clearInterval(screenshotInterval);
    console.log('Client disconnected');
  });
});

// REST API endpoints
app.get('/', ((_req: Request, res: Response) => {
  console.log('\n[GET /]');
  console.log('Health check request received');
  res.send('AI Automation Server Running');
  console.log('Health check response sent');
}) as RequestHandler);

app.get('/api/observe', (async (req: Request, res: Response) => {
  console.log('\n[GET /api/observe]');
  console.log('Query params:', req.query);
  const startTime = Date.now();

  try {
    const page = puppeteerManager.getPage();
    const title = await page.title();
    const url = page.url();
    const html = await page.content();
    const response = { url, title, html };
    
    console.log('Response:', { url, title, htmlLength: html.length });
    console.log(`Completed in ${Date.now() - startTime}ms`);
    res.json(response);
  } catch (err) {
    console.error('Error in /api/observe:', err);
    console.log(`Failed in ${Date.now() - startTime}ms`);
    res.status(500).json({ error: String(err) });
  }
}) as RequestHandler);

app.post('/api/script', (async (req: Request<{}, any, ScriptRequest>, res: Response) => {
  console.log('\n[POST /api/script]');
  console.log('Request body:', req.body);
  const startTime = Date.now();

  const { code } = req.body;
  if (!code) {
    console.log('Error: No code provided');
    return res.status(400).json({ error: 'No code provided.' });
  }

  try {
    const page = puppeteerManager.getPage();
    const result = await page.evaluate(code);
    
    console.log('Script result:', result);
    console.log(`Completed in ${Date.now() - startTime}ms`);
    res.json({ result });
  } catch (err) {
    console.error('Error in /api/script:', err);
    console.log(`Failed in ${Date.now() - startTime}ms`);
    res.status(500).json({ error: String(err) });
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
    res.json({ result });
  } catch (err) {
    console.error('Error in /api/node-script:', err);
    console.log(`Failed in ${Date.now() - startTime}ms`);
    res.status(500).json({ error: String(err) });
  }
}) as RequestHandler);

app.post('/api/puppeteer', (async (req: Request, res: Response) => {
  console.log('\n[POST /api/puppeteer]');
  console.log('Request body:', req.body);
  const startTime = Date.now();

  try {
    const { script } = req.body;
    if (!script) {
      console.log('Error: Script is required');
      return res.status(400).json({ error: 'Script is required' });
    }

    const page = puppeteerManager.getPage();
    const result = await toolManager.executeTool('execute_script', page, { script });
    
    console.log('Puppeteer script result:', result);
    console.log(`Completed in ${Date.now() - startTime}ms`);
    res.json(result);
  } catch (error) {
    console.error('Error in /api/puppeteer:', error);
    console.log(`Failed in ${Date.now() - startTime}ms`);
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
}) as RequestHandler);

app.post('/api/tool', (async (req: Request, res: Response) => {
  console.log('\n[POST /api/tool]');
  console.log('Request body:', req.body);
  const startTime = Date.now();

  const { toolName, args } = req.body;

  if (!toolName) {
    console.log('Error: Tool name is required');
    return res.status(400).json({ error: 'Tool name is required' });
  }

  try {
    const page = puppeteerManager.getPage();
    const result = await toolManager.executeTool(toolName, page, args);

    console.log('Tool execution result:', result);
    console.log(`Completed in ${Date.now() - startTime}ms`);
    res.json({ result });
  } catch (error) {
    console.error('Error executing tool:', error);
    console.log(`Failed in ${Date.now() - startTime}ms`);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : String(error)
    });
  }
}) as RequestHandler);

// Start server
const PORT = process.env.PORT || 4000;
// Handle process cleanup
process.on('SIGTERM', async () => {
  console.log('\n[Server Shutdown] Received SIGTERM signal');
  console.log('Closing Puppeteer...');
  await puppeteerManager.close();
  console.log('Puppeteer closed successfully');
  console.log('Server shutdown complete');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n[Server Shutdown] Received SIGINT signal');
  console.log('Closing Puppeteer...');
  await puppeteerManager.close();
  console.log('Puppeteer closed successfully');
  console.log('Server shutdown complete');
  process.exit(0);
});

// Initialize server
(async () => {
  try {
    // Ensure only one Puppeteer instance
    // Initialize Puppeteer with retries
    await puppeteerManager.init({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    }, 5); // 5 retries with backoff

    // Verify Puppeteer is initialized
    if (!puppeteerManager.getPage()) {
      throw new Error('Puppeteer failed to initialize');
    }

    server.listen(PORT, () => {
      console.log('\n=== AI Automation Server Initialized ===');
      console.log(`- HTTP/WebSocket server running on port ${PORT}`);
      console.log('- Puppeteer initialized successfully');
      console.log('- CORS enabled for localhost:3001');
      console.log('- WebSocket screenshot streaming ready');
      console.log('- All API endpoints registered');
      console.log('========================================\n');
    });
  } catch (error) {
    console.error('Failed to initialize Puppeteer:', error);
    await puppeteerManager.close();
    process.exit(1);
  }
})();
