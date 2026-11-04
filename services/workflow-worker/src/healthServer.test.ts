import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { HealthServer } from './healthServer';
import { createWorkflowWorkerMetrics } from './metrics';

const getFreePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });

describe('HealthServer', () => {
  let server: HealthServer | null = null;
  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  const startOnFreePort = async (withMetrics: boolean) => {
    const metrics = createWorkflowWorkerMetrics({ collectDefaults: false });
    metrics.recordLaunchSkip({ tenant: 't1', workflowId: 'w1', eventName: 'PING', reason: 'paused', intentional: true });
    metrics.recordLaunch({ tenant: 't1', workflowId: 'w1', eventName: 'PING' });
    const port = await getFreePort();
    server = new HealthServer(port, withMetrics ? metrics.registry : undefined);
    await server.start();
    return port;
  };

  it('serves Prometheus text with both counters on GET /metrics', async () => {
    const port = await startOnFreePort(true);
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('alga_workflow_event_launch_skips_total');
    expect(body).toContain('alga_workflow_event_launches_total');
  });

  it('leaves /health unchanged (503 before ready, 200 after)', async () => {
    const port = await startOnFreePort(true);
    let res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(503);
    const before = await res.json();
    expect(Object.keys(before).sort()).toEqual(['ready', 'startedAt', 'workers']);
    server!.setWorker('x', true);
    server!.markReady();
    res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).workers).toEqual({ x: true });
  });

  it('404s /metrics when no registry is provided', async () => {
    const port = await startOnFreePort(false);
    expect((await fetch(`http://127.0.0.1:${port}/metrics`)).status).toBe(404);
  });
});
