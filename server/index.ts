import express from 'express';
import next from 'next';
import cookieParser from 'cookie-parser';
import { 
  apiKeyAuthMiddleware, 
  sessionAuthMiddleware, 
  tenantHeaderMiddleware,
  authorizationMiddleware 
} from './src/middleware/express/authMiddleware';

const dev = globalThis.process.env.NODE_ENV !== 'production';
const hostname = globalThis.process.env.HOSTNAME || 'localhost';
const port = parseInt(globalThis.process.env.PORT || '3000', 10);

// Initialize Next.js
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function createServer() {
  try {
    console.log('Preparing Next.js application...');
    await app.prepare();
    console.log('Next.js application prepared successfully');

    const server = express();

    // Enable cookie parsing for NextAuth compatibility
    server.use(cookieParser() as any);

    // Apply authentication middleware in order
    server.use(apiKeyAuthMiddleware);      // Handle API key authentication for API routes
    server.use(sessionAuthMiddleware);     // Handle NextAuth sessions for web routes  
    server.use(authorizationMiddleware);   // Handle additional authorization checks
    server.use(tenantHeaderMiddleware);    // Add tenant headers to responses

    // Basic health check endpoints for Kubernetes
    server.get('/healthz', (_req, res) => {
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: globalThis.process.uptime(),
        version: '1.0.0'
      });
    });

    server.get('/readyz', (_req, res) => {
      // TODO: Add database and dependency checks
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        uptime: globalThis.process.uptime(),
        version: '1.0.0'
      });
    });

    // Handle all other requests with Next.js
    // This catches any request that wasn't handled by explicit routes above
    server.use((req, res, next) => {
      // Don't let Next.js handle health endpoints
      if (req.path === '/healthz' || req.path === '/readyz') {
        // These should have been handled above, if we get here something is wrong
        return next();
      }
      
      // Let Next.js handle everything else
      return handle(req, res);
    });

    server.on('error', (err) => {
      console.error('Express server error:', err);
    });

    server.listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
      console.log(`> Environment: ${dev ? 'development' : 'production'}`);
    });

  } catch (error) {
    console.error('Error starting server:', error);
    globalThis.process.exit(1);
  }
}

// Start the server
void createServer();