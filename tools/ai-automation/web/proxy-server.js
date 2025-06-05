const http = require('http');
const { parse } = require('url');

// This enhances the Next.js standalone server with WebSocket proxy
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://ai-api:4000';
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOSTNAME = process.env.HOSTNAME || '0.0.0.0';

console.log('=== AI Web Proxy Server Configuration ===');
console.log(`Port: ${PORT}`);
console.log(`Hostname: ${HOSTNAME}`);
console.log(`Backend API: ${API_BASE}`);
console.log(`NODE_OPTIONS: ${process.env.NODE_OPTIONS || 'not set'}`);
console.log('=========================================');

// First check if http-proxy-middleware is available
let createProxyMiddleware;
try {
  createProxyMiddleware = require('http-proxy-middleware').createProxyMiddleware;
  console.log('✓ http-proxy-middleware loaded successfully');
} catch (err) {
  console.error('✗ Failed to load http-proxy-middleware:', err.message);
  console.log('Running without WebSocket proxy support');
}

// Start Next.js server on a different port
const { spawn } = require('child_process');
const NEXT_PORT = 3001;

// Start the Next.js server on port 3001
const nextProcess = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: NEXT_PORT.toString() },
  stdio: 'inherit'
});

nextProcess.on('error', (err) => {
  console.error('Failed to start Next.js server:', err);
  process.exit(1);
});

// Give Next.js time to start
setTimeout(() => {
  console.log('✓ Next.js server should be running on port', NEXT_PORT);
}, 2000);

// Create WebSocket proxy if middleware is available
let wsProxy;
if (createProxyMiddleware) {
  wsProxy = createProxyMiddleware('/socket.io', {
    target: API_BASE,
    ws: true,
    changeOrigin: true,
    logLevel: 'debug',
    onProxyReq: (proxyReq, req, res) => {
      console.log(`[WS-PROXY] Proxying: ${req.url} -> ${API_BASE}${req.url}`);
    },
    onError: (err, req, res) => {
      console.error(`[WS-PROXY-ERROR] Error:`, err.message);
      console.error(`[WS-PROXY-ERROR] Stack:`, err.stack);
    },
    onProxyReqWs: (proxyReq, req, socket, options, head) => {
      console.log(`[WS-PROXY] WebSocket upgrade: ${req.url}`);
      console.log(`[WS-PROXY] Headers:`, req.headers);
    },
    onOpen: (proxySocket) => {
      console.log('[WS-PROXY] WebSocket connection opened');
    },
    onClose: (res, socket, head) => {
      console.log('[WS-PROXY] WebSocket connection closed');
    }
  });
  console.log('✓ WebSocket proxy configured');
}

// Create proxy for Next.js app
const nextProxy = createProxyMiddleware && createProxyMiddleware({
  target: `http://localhost:${NEXT_PORT}`,
  changeOrigin: true,
  ws: false, // Don't proxy WebSocket for Next.js routes
  logLevel: 'warn'
});

// Create a custom server that routes requests appropriately
const server = http.createServer((req, res) => {
  const parsedUrl = parse(req.url, true);
  
  // Log all requests for debugging
  console.log(`[REQUEST] ${req.method} ${req.url}`);
  
  // Handle Socket.IO requests with WebSocket proxy
  if (wsProxy && parsedUrl.pathname.startsWith('/socket.io')) {
    console.log('[REQUEST] Routing to WebSocket proxy');
    wsProxy(req, res);
  } else if (nextProxy) {
    // Proxy everything else to Next.js
    console.log('[REQUEST] Routing to Next.js');
    nextProxy(req, res);
  } else {
    // Fallback if proxy middleware is not available
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Service temporarily unavailable');
  }
});

// Handle WebSocket upgrades
server.on('upgrade', (request, socket, head) => {
  const pathname = parse(request.url).pathname;
  console.log(`[UPGRADE] WebSocket upgrade request for: ${pathname}`);
  
  if (wsProxy && pathname.startsWith('/socket.io')) {
    console.log(`[UPGRADE] Proxying Socket.IO WebSocket`);
    wsProxy.upgrade(request, socket, head);
  } else {
    console.log(`[UPGRADE] No handler for path: ${pathname}`);
    socket.destroy();
  }
});

// Error handling
server.on('error', (err) => {
  console.error('[SERVER-ERROR]', err);
});

server.listen(PORT, HOSTNAME, (err) => {
  if (err) throw err;
  console.log(`> Ready with WebSocket proxy on http://${HOSTNAME}:${PORT}`);
  console.log(`> Next.js app serving at /`);
  console.log(`> WebSocket proxy at /socket.io -> ${API_BASE}`);
});