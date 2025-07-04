import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, Runtime, DefaultLogger } from '@temporalio/worker';

describe('Basic E2E Setup Test', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    // Configure runtime for testing
    Runtime.install({
      logger: new DefaultLogger('WARN'),
      telemetryOptions: {
        disabled: true,
      },
    });

    // Create test workflow environment
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await testEnv?.teardown();
  });

  it('should create and teardown Temporal test environment', async () => {
    expect(testEnv).toBeDefined();
    expect(testEnv.nativeConnection).toBeDefined();
    expect(testEnv.client).toBeDefined();
  });

  it('should be able to create a worker', async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: 'test-queue',
      workflows: {
        // Simple test workflow
        testWorkflow: async () => {
          return { success: true, message: 'Hello from test workflow!' };
        },
      },
    });

    expect(worker).toBeDefined();
    await worker.shutdown();
  });

  it('should be able to execute a simple workflow', async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: 'test-queue',
      workflows: {
        simpleWorkflow: async () => {
          return { result: 'success', timestamp: new Date().toISOString() };
        },
      },
    });

    const handle = await testEnv.client.workflow.start('simpleWorkflow', {
      args: [],
      taskQueue: 'test-queue',
      workflowId: 'test-workflow-' + Date.now(),
    });

    const result = await handle.result();

    expect(result).toBeDefined();
    expect(result.result).toBe('success');
    expect(result.timestamp).toBeDefined();

    await worker.shutdown();
  });
});