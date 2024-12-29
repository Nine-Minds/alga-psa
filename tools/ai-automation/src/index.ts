import express, { Request, Response, RequestHandler } from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { puppeteerManager } from './puppeteerManager';

interface ScriptRequest {
  code: string;
}

const app: express.Application = express();
const server = http.createServer(app);
const io = new Server(server);
io.engine.on("connection", (rawSocket) => {
  rawSocket.setTimeout(0);
  rawSocket.setNoDelay(true);
  rawSocket.setKeepAlive(true, 0);
});

app.use(cors());
app.use(express.json());

// WebSocket connection for screenshot streaming
io.on('connection', (socket) => {
  console.log('Client connected for screenshot streaming');

  const interval = setInterval(async () => {
    try {
      const page = puppeteerManager.getPage();
      const buf = await page.screenshot();
      const base64img = Buffer.from(buf).toString('base64');
      socket.emit('screenshot', base64img);
    } catch (error) {
      console.error('Error taking screenshot', error);
    }
  }, 2000); // every 2 seconds

  socket.on('disconnect', () => {
    clearInterval(interval);
    console.log('Client disconnected');
  });
});

// REST API endpoints
app.get('/', ((_req: Request, res: Response) => {
  res.send('AI Automation Server Running');
}) as RequestHandler);

app.get('/api/observe', (async (req: Request, res: Response) => {
  try {
    const page = puppeteerManager.getPage();
    const title = await page.title();
    const url = page.url();
    const html = await page.content();
    res.json({ url, title, html });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}) as RequestHandler);

app.post('/api/script', (async (req: Request<{}, any, ScriptRequest>, res: Response) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'No code provided.' });
  }
  try {
    const page = puppeteerManager.getPage();
    const result = await page.evaluate(code);
    res.json({ result });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}) as RequestHandler);

app.post('/api/node-script', (async (req: Request<{}, any, ScriptRequest>, res: Response) => {
  const { code } = req.body;
  try {
    const fn = new Function('require', 'page', code);
    const page = puppeteerManager.getPage();
    const result = await fn(require, page);
    res.json({ result });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}) as RequestHandler);

// Start server
const PORT = process.env.PORT || 4000;
(async () => {
  try {
    await puppeteerManager.init();
    server.listen(PORT, () => {
      console.log(`Server with WebSocket listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to initialize Puppeteer:', error);
    process.exit(1);
  }
})();
