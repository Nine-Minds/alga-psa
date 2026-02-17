import { describe, it, expect } from 'vitest';
import { Connection } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';

const runTemporalTests = process.env.RUN_TEMPORAL_TESTS === 'true';
const describeTemporal = runTemporalTests ? describe : describe.skip;

describeTemporal('Temporal Connection Tests', () => {
  it('should connect to temporalio/auto-setup Docker container', async () => {
    const connection = await Connection.connect({
      address: 'localhost:7233',
    });

    expect(connection).toBeDefined();
    
    // Test basic connection health
    const systemInfo = await connection.workflowService.getSystemInfo({});
    expect(systemInfo.serverVersion).toBeDefined();
    
    await connection.close();
  });

  it('should create TestWorkflowEnvironment for unit tests', async () => {
    const testEnv = await TestWorkflowEnvironment.createTimeSkipping();
    
    expect(testEnv).toBeDefined();
    expect(testEnv.client).toBeDefined();
    expect(testEnv.nativeConnection).toBeDefined();
    
    await testEnv.teardown();
  });

  it('should verify Docker Postgres connection', async () => {
    // Test that we can connect to the test Postgres instance
    const { Pool } = await import('pg');
    
    const pool = new Pool({
      host: 'localhost',
      port: 5433, // Test port from docker-compose
      database: 'temporal',
      user: 'temporal',
      password: 'temporal',
    });

    const client = await pool.connect();
    const result = await client.query('SELECT 1 as test');
    expect(result.rows[0].test).toBe(1);
    
    client.release();
    await pool.end();
  });
});
