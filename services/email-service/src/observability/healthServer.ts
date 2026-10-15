/**
 * HTTP surface (cluster-internal, one port).
 *
 *  /health   unconditional 200, no I/O (livenessProbe)
 *  /ready    DB + Redis + consumer heartbeat, 503 on failure (readinessProbe)
 *  /metrics  Prometheus text from the in-process registry (404 when disabled)
 *  /status   always HTTP 200; verdict in the body (version 1)
 *
 * Routes match on the path only; the query string is ignored.
 */

import http from 'node:http';
import logger from '@alga-psa/core/logger';
import type { InboundEmailMetrics } from './registry';
import type { CollectorCache } from './healthCollector';
import type { createReadiness } from './readiness';
import { STATUS_SCHEMA_VERSION, buildStatusSummary } from './statusSummary';

export interface HealthServerDeps {
  metrics: InboundEmailMetrics;
  readiness: ReturnType<typeof createReadiness>;
  getCollectorCache: () => CollectorCache;
  getImapStats: () => { activeListeners: number; providersLeased: number };
  metricsEnabled?: boolean;
  now?: () => number;
}

export function isMetricsEnabledFromEnv(): boolean {
  return (process.env.EMAIL_SERVICE_METRICS_ENABLED ?? '').trim().toLowerCase() !== 'false';
}

function send(res: http.ServerResponse, status: number, contentType: string, body: string) {
  res.statusCode = status;
  res.setHeader('content-type', contentType);
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

export function createHealthServer(deps: HealthServerDeps): http.Server {
  const now = deps.now ?? Date.now;
  const metricsEnabled = deps.metricsEnabled ?? isMetricsEnabledFromEnv();

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const path = (req.url ?? '').split('?')[0];

    if (path === '/health') return send(res, 200, 'text/plain; charset=utf-8', 'ok');

    if (path === '/ready') {
      const result = await deps.readiness.run();
      const body = JSON.stringify({ status: result.ok ? 'ready' : 'not_ready', checks: result.checks });
      return send(res, result.ok ? 200 : 503, 'application/json', body);
    }

    if (path === '/metrics' && metricsEnabled) {
      const body = await deps.metrics.register.metrics();
      return send(res, 200, deps.metrics.register.contentType, body);
    }

    if (path === '/status') {
      // Always HTTP 200 (kubectl --raw readers drop the body on non-2xx); the
      // verdict is in the body. Even an internal failure is reported as 200/down.
      try {
        const result = await deps.readiness.runCached();
        const summary = buildStatusSummary({
          nowMs: now(),
          checks: result.checks,
          collector: deps.getCollectorCache(),
          imap: deps.getImapStats(),
        });
        return send(res, 200, 'application/json', JSON.stringify(summary));
      } catch (error) {
        logger.error('[IMAP] Status summary failed', { errorName: (error as Error)?.name });
        const body = {
          version: STATUS_SCHEMA_VERSION,
          service: 'email-service',
          status: 'down',
          generatedAt: new Date(now()).toISOString(),
          reasons: [{ code: 'status_unavailable', severity: 'down', message: 'The status summary could not be built' }],
        };
        return send(res, 200, 'application/json', JSON.stringify(body));
      }
    }

    return send(res, 404, 'text/plain; charset=utf-8', 'not found');
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      logger.error('[IMAP] Health server request failed', { path: req.url?.split('?')[0], errorName: (error as Error)?.name });
      if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'error');
      else res.end();
    });
  });
  return server;
}
