import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { Client, Connection } from '@temporalio/client';
import * as activities from '../activities/index.js';
import { tenantCreationWorkflow } from '../workflows/index.js';
import type { TenantCreationInput, TenantCreationResult } from '../types/workflow-types.js';

export interface TestTemporalClient {
  startTenantCreation: (input: TenantCreationInput) => Promise<{
    workflowId: string;
    result: Promise<TenantCreationResult>;
  }>;
  getWorkflowState: (workflowId: string) => Promise<any>;
  cancelWorkflow: (workflowId: string, reason: string) => Promise<void>;
  cleanup: () => Promise<void>;
}

/**
 * Set up Temporal test environment with time skipping for fast tests
 */
export async function setupTestWorkflow(): Promise<TestTemporalClient> {
  // Create test environment with time skipping for fast execution
  const testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  
  const { client, nativeConnection } = testEnv;
  const taskQueue = 'test-tenant-workflows';
  
  // Create worker with test activities
  const worker = await Worker.create({
    connection: nativeConnection,
    taskQueue,
    workflowsPath: new URL('../workflows/index.js', import.meta.url).pathname,
    activities,
  });
  
  const testClient: TestTemporalClient = {
    async startTenantCreation(input: TenantCreationInput) {
      const workflowId = `test-tenant-creation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const handle = await client.workflow.start(tenantCreationWorkflow, {
        args: [input],
        taskQueue,
        workflowId,
        workflowExecutionTimeout: '1m',
      });
      
      return {
        workflowId: handle.workflowId,
        result: handle.result() as Promise<TenantCreationResult>,
      };
    },

    async getWorkflowState(workflowId: string) {
      const handle = client.workflow.getHandle(workflowId);
      return await handle.query('getState');
    },

    async cancelWorkflow(workflowId: string, reason: string) {
      const handle = client.workflow.getHandle(workflowId);
      await handle.signal('cancel', { reason, cancelledBy: 'test' });
    },

    async cleanup() {
      await testEnv.teardown();
    }
  };

  // Start worker in background
  const workerPromise = worker.runUntil(async () => {
    // Worker will run until cleanup is called
    await new Promise(resolve => {
      const originalCleanup = testClient.cleanup;
      testClient.cleanup = async () => {
        resolve(undefined);
        await originalCleanup();
      };
    });
  });

  return testClient;
}

/**
 * Run a workflow test with automatic cleanup
 */
export async function runWorkflowTest<T>(
  testFn: (client: TestTemporalClient) => Promise<T>
): Promise<T> {
  const client = await setupTestWorkflow();
  try {
    return await testFn(client);
  } finally {
    await client.cleanup();
  }
}

/**
 * Mock email service for testing
 */
export class MockEmailService {
  private sentEmails: Array<{
    to: string;
    subject: string;
    html: string;
    text: string;
    timestamp: Date;
  }> = [];
  
  private shouldFail = false;
  
  async sendEmail(params: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }) {
    if (this.shouldFail) {
      throw new Error('Mock email service failure');
    }
    
    this.sentEmails.push({
      ...params,
      timestamp: new Date(),
    });
    
    return { messageId: `mock-${Date.now()}` };
  }
  
  getSentEmails() {
    return [...this.sentEmails];
  }
  
  getLastEmail() {
    return this.sentEmails[this.sentEmails.length - 1];
  }
  
  clearEmails() {
    this.sentEmails = [];
  }
  
  simulateFailure(shouldFail = true) {
    this.shouldFail = shouldFail;
  }
  
  getEmailsSentTo(email: string) {
    return this.sentEmails.filter(e => e.to === email);
  }
}

/**
 * Test utilities for workflow assertions
 */
export class WorkflowAssertions {
  constructor(private result: TenantCreationResult) {}
  
  expectSuccess() {
    expect(this.result.success).toBe(true);
    return this;
  }
  
  expectFailure() {
    expect(this.result.success).toBe(false);
    return this;
  }
  
  expectTenantCreated() {
    expect(this.result.tenantId).toBeDefined();
    expect(this.result.tenantId).not.toBe('');
    return this;
  }
  
  expectUserCreated() {
    expect(this.result.adminUserId).toBeDefined();
    expect(this.result.adminUserId).not.toBe('');
    return this;
  }
  
  expectTemporaryPassword() {
    expect(this.result.temporaryPassword).toBeDefined();
    expect(this.result.temporaryPassword.length).toBeGreaterThanOrEqual(8);
    return this;
  }
  
  expectEmailSent() {
    expect(this.result.emailSent).toBe(true);
    return this;
  }
  
  expectEmailFailed() {
    expect(this.result.emailSent).toBe(false);
    return this;
  }
}

/**
 * Create workflow assertions helper
 */
export function expectWorkflowResult(result: TenantCreationResult) {
  return new WorkflowAssertions(result);
}

/**
 * Test data generators
 */
export function generateTestInput(overrides: Partial<TenantCreationInput> = {}): TenantCreationInput {
  const timestamp = Date.now();
  return {
    tenantName: `test-tenant-${timestamp}`,
    adminUser: {
      firstName: 'Test',
      lastName: 'Admin',
      email: `test-${timestamp}@example.com`,
    },
    clientName: `Test Client ${timestamp}`,
    ...overrides,
  };
}

/**
 * Wait for workflow completion with timeout
 */
export async function waitForWorkflow<T>(
  workflowPromise: Promise<T>,
  timeoutMs = 10000
): Promise<T> {
  return Promise.race([
    workflowPromise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Workflow timeout after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}