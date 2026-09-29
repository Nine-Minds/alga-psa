import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Connection } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';

describe('owned Temporal connection', () => {
  let environment: TestWorkflowEnvironment;
  beforeAll(async () => { environment = await TestWorkflowEnvironment.createTimeSkipping(); });
  afterAll(async () => { await environment?.teardown(); });

  it('connects a separate client and completes a service health request', async () => {
    const connection = await Connection.connect({ address: environment.address });
    try {
      const systemInfo = await connection.workflowService.getSystemInfo({});
      expect(systemInfo.serverVersion).toEqual(expect.any(String));
      const health = await connection.healthService.check({ service: '' });
      expect(health.status).toBe(1); // gRPC SERVING
    } finally { await connection.close(); }
  });

  it('advances the owned test environment clock', async () => {
    const before = await environment.currentTimeMs();
    await environment.sleep(1000);
    expect(await environment.currentTimeMs()).toBeGreaterThanOrEqual(before + 1000);
  });
});
