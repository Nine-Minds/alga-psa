import http from 'node:http';
import logger from '@alga-psa/core/logger';
import type { Registry } from 'prom-client';

export interface HealthSnapshot {
  ready: boolean;
  startedAt: string;
  workers: Record<string, boolean>;
}

/**
 * Minimal HTTP server that also serves GET /metrics (Prometheus) and answers the /health probe Istio rewrites
 * kubelet's liveness/readiness checks to. Returns 200 once markReady()
 * has been called and 503 before that so kubelet sees an honest state
 * during startup.
 */
export class HealthServer {
  private server: http.Server | null = null;
  private readonly port: number;
  private state: HealthSnapshot;

  private readonly metricsRegistry: Registry | null;

  constructor(port?: number, metricsRegistry?: Registry) {
    this.metricsRegistry = metricsRegistry ?? null;
    this.port = Number(port ?? process.env.PORT ?? 4000);
    this.state = {
      ready: false,
      startedAt: new Date().toISOString(),
      workers: {},
    };
  }

  setWorker(name: string, ready: boolean): void {
    this.state.workers[name] = ready;
  }

  markReady(): void {
    this.state.ready = true;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const path = (req.url ?? '/').split('?')[0];
        if (path === '/health' || path === '/livez' || path === '/readyz') {
          res.statusCode = this.state.ready ? 200 : 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(this.state));
          return;
        }
        if (path === '/metrics' && this.metricsRegistry) {
          const registry = this.metricsRegistry;
          registry.metrics().then(
            (body) => {
              res.statusCode = 200;
              res.setHeader('Content-Type', registry.contentType);
              res.end(body);
            },
            (err) => {
              logger.error('[HealthServer] Failed to render metrics', { err });
              res.statusCode = 500;
              res.end();
            }
          );
          return;
        }
        res.statusCode = 404;
        res.end();
      });

      server.once('error', (err) => {
        logger.error('[HealthServer] Failed to listen', { err });
        reject(err);
      });

      server.listen(this.port, () => {
        logger.info('[HealthServer] Listening', { port: this.port });
        this.server = server;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
