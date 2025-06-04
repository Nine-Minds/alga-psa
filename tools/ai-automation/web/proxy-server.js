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

// Import the Next.js standalone server handler
let nextHandler;
try {
  nextHandler = require('./server.js');
  console.log('✓ Next.js standalone server loaded');
} catch (err) {
  console.error('✗ Failed to load Next.js server:', err.message);
  throw err;
}

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

// Create a custom server that wraps the Next.js handler
const server = http.createServer((req, res) => {
  const parsedUrl = parse(req.url, true);
  
  // Log all requests for debugging
  console.log(`[REQUEST] ${req.method} ${req.url}`);
  
  // Handle Socket.IO requests with proxy
  if (wsProxy && parsedUrl.pathname.startsWith('/socket.io')) {
    console.log('[REQUEST] Routing to WebSocket proxy');
    wsProxy(req, res);
  } else {
    // Let Next.js handle everything else
    console.log('[REQUEST] Routing to Next.js');
    nextHandler(req, res);
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