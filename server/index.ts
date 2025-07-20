import express from 'express';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

// Initialize Next.js
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function createServer() {
  try {
    console.log('Preparing Next.js application...');
    await app.prepare();
    console.log('Next.js application prepared successfully');

    const server = express();

    // Basic health check endpoints for Kubernetes
    server.get('/healthz', (req, res) => {
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0'
      });
    });

    server.get('/readyz', (req, res) => {
      // TODO: Add database and dependency checks
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0'
      });
    });

    // Handle all other requests with Next.js
    // Next.js should handle everything that hasn't been handled above
    server.use(handle);

    server.on('error', (err) => {
      console.error('Express server error:', err);
    });

    server.listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
      console.log(`> Environment: ${dev ? 'development' : 'production'}`);
    });

  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

// Start the server
createServer();