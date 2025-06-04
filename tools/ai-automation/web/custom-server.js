const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { createProxyMiddleware } = require('http-proxy-middleware');

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = process.env.PORT || 3000;

// Configure Next.js
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Backend API URL
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://ai-api:4000';

console.log('=== AI Web Server Configuration ===');
console.log(`Environment: ${dev ? 'development' : 'production'}`);
console.log(`Hostname: ${hostname}`);
console.log(`Port: ${port}`);
console.log(`Backend API: ${API_BASE}`);
console.log(`NODE_OPTIONS: ${process.env.NODE_OPTIONS || 'not set'}`);
console.log('===================================');

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    
    // Handle Socket.IO WebSocket connections
    if (parsedUrl.pathname === '/socket.io/') {
      return;
    }
    
    // Let Next.js handle everything else
    handle(req, res, parsedUrl);
  });

  // Set up WebSocket proxy for Socket.IO
  const wsProxy = createProxyMiddleware('/socket.io', {
    target: API_BASE,
    ws: true,
    changeOrigin: true,
    logLevel: 'debug',
    onProxyReq: (proxyReq, req, res) => {
      console.log(`[WS-PROXY] Proxying WebSocket request: ${req.url} -> ${API_BASE}${req.url}`);
    },
    onProxyRes: (proxyRes, req, res) => {
      console.log(`[WS-PROXY] Received response: ${proxyRes.statusCode} for ${req.url}`);
    },
    onError: (err, req, res) => {
      console.error(`[WS-PROXY-ERROR] WebSocket proxy error for ${req.url}:`, err.message);
      console.error(`[WS-PROXY-ERROR] Stack trace:`, err.stack);
    },
    onProxyReqWs: (proxyReq, req, socket, options, head) => {
      console.log(`[WS-PROXY] WebSocket upgrade request: ${req.url}`);
      console.log(`[WS-PROXY] Headers:`, req.headers);
    },
    onOpen: (proxySocket) => {
      console.log('[WS-PROXY] WebSocket connection opened');
      proxySocket.on('data', (data) => {
        console.log(`[WS-PROXY] Data received: ${data.toString().substring(0, 100)}...`);
      });
    },
    onClose: (res, socket, head) => {
      console.log('[WS-PROXY] WebSocket connection closed');
    }
  });

  // Apply the WebSocket proxy middleware
  server.on('request', (req, res) => {
    if (req.url.startsWith('/socket.io')) {
      wsProxy(req, res);
    }
  });

  // Upgrade WebSocket connections
  server.on('upgrade', (request, socket, head) => {
    const pathname = parse(request.url).pathname;
    console.log(`[UPGRADE] WebSocket upgrade request for: ${pathname}`);
    
    if (pathname.startsWith('/socket.io')) {
      console.log(`[UPGRADE] Handling Socket.IO upgrade for: ${pathname}`);
      wsProxy.upgrade(request, socket, head);
    } else {
      console.log(`[UPGRADE] No handler for WebSocket path: ${pathname}`);
      socket.destroy();
    }
  });

  server.listen(port, hostname, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Proxying WebSocket to ${API_BASE}`);
  });
});