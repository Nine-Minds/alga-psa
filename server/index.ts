import express from 'express';
import next from 'next';
import cookieParser from 'cookie-parser';
import { runWithTenant } from '@alga-psa/db';
import {
  apiKeyAuthMiddleware,
  sessionAuthMiddleware,
  tenantHeaderMiddleware,
  authorizationMiddleware
} from './src/middleware/express/authMiddleware';
import { getAppVersion } from './src/lib/utils/version';

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

    // Next.js will handle its internal routes (/_next, HMR, static files) automatically

    // Apply authentication middleware in order (after Next.js internal routes)
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
        version: getAppVersion()
      });
    });

    server.get('/readyz', (_req, res) => {
      // TODO: Add database and dependency checks
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        uptime: globalThis.process.uptime(),
        version: getAppVersion()
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

      const tenant =
        (req as any).apiKey?.tenant ||
        (req as any).user?.tenant ||
        (req.headers['x-tenant-id'] as string | undefined) ||
        (req.headers['x-auth-tenant'] as string | undefined);

      // Ensure tenant context is available to server actions / DB helpers that use AsyncLocalStorage.
      // This is the earliest point where we have reliable tenant info from either API key auth
      // or NextAuth session auth, and it wraps the entire Next.js request lifecycle.
      if (tenant) {
        return runWithTenant(tenant, async () => handle(req, res));
      }

      // Let Next.js handle everything else
      return handle(req, res);
    });

    const httpServer = server.listen(port, '0.0.0.0', () => {
      console.log(`> Ready on http://${hostname}:${port}`);
      console.log(`> Environment: ${dev ? 'development' : 'production'}`);
      console.log(`> Version: ${getAppVersion()}`);
    });

    httpServer.on('error', (err) => {
      console.error('HTTP server error:', err);
    });

    // Next.js handles WebSocket upgrades for HMR automatically

  } catch (error) {
    console.error('Error starting server:', error);
    globalThis.process.exit(1);
  }
}

// Start the server
void createServer();
