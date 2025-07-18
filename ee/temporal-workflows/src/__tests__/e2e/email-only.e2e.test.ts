import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client, Connection } from '@temporalio/client';
import { Worker } from '@temporalio/worker';
import { generateTemporaryPassword, sendWelcomeEmail } from '../../activities/email-activities';
import { testEmailWorkflow } from '../../workflows/test-email-workflow';
import type { SendWelcomeEmailActivityInput } from '../../types/workflow-types';
import path from 'path';

describe('Email Activities - E2E Tests', () => {
  let connection: Connection;
  let client: Client;
  let worker: Worker;

  beforeAll(async () => {
    // Try creating worker without explicit connection first
    try {
      // Create worker using default connection settings
      worker = await Worker.create({
        taskQueue: 'email-e2e-test-queue',
        workflowsPath: path.resolve(__dirname, '../../workflows'),
        activities: {
          generateTemporaryPassword,
          sendWelcomeEmail,
        },
        // Worker options - fix the configuration issue
        maxConcurrentActivityTaskExecutions: 1,
        maxConcurrentWorkflowTaskExecutions: 1,
        maxCachedWorkflows: 0, // Disable workflow caching to avoid the config issue
      });

      // Get the connection from the worker
      connection = worker.connection;
      
      client = new Client({
        connection,
        namespace: 'default',
      });
      
      // Start the worker
      worker.run().catch(error => {
        console.error('Worker error:', error);
      });
      
      // Give the worker time to start
      await new Promise(resolve => setTimeout(resolve, 3000));
      
    } catch (error) {
      console.error('Failed to create worker:', error);
      throw error;
    }
  }, 60000);

  afterAll(async () => {
    if (worker) {
      await worker.shutdown();
    }
    if (connection) {
      await connection.close();
    }
  });

  describe('End-to-End Email Workflow', () => {
    it('should execute complete email workflow with password generation', async () => {
      const timestamp = Date.now();
      const input: SendWelcomeEmailActivityInput = {
        tenantId: `tenant-${timestamp}`,
        tenantName: 'E2E Test Tenant',
        adminUser: {
          userId: `user-${timestamp}`,
          email: `e2e-test-${timestamp}@example.com`,
          firstName: 'E2E',
          lastName: 'Test',
        },
        temporaryPassword: '', // Will be generated by workflow
        companyName: 'E2E Test Company',
        loginUrl: 'https://e2e-test.example.com/login',
      };

      // Execute the workflow end-to-end
      const handle = await client.workflow.start(testEmailWorkflow, {
        args: [input],
        taskQueue: 'email-e2e-test-queue',
        workflowId: `email-e2e-test-${timestamp}`,
      });

      const result = await handle.result();

      // Verify password was generated
      expect(result.temporaryPassword).toBeDefined();
      expect(result.temporaryPassword).toHaveLength(12);
      expect(result.temporaryPassword).toMatch(/[A-Z]/);
      expect(result.temporaryPassword).toMatch(/[a-z]/);
      expect(result.temporaryPassword).toMatch(/[2-9]/);
      expect(result.temporaryPassword).toMatch(/[!@#$%^&*]/);
      expect(result.temporaryPassword).not.toMatch(/[0O1lI]/);

      // Verify email was sent
      expect(result.emailResult.emailSent).toBe(true);
      expect(result.emailResult.messageId).toBeDefined();
      expect(result.emailResult.messageId).toMatch(/^mock-/);
      expect(result.emailResult.error).toBeUndefined();
    });

    it('should handle workflow with invalid email gracefully', async () => {
      const timestamp = Date.now();
      const input: SendWelcomeEmailActivityInput = {
        tenantId: `tenant-${timestamp}`,
        tenantName: 'Invalid Email Test',
        adminUser: {
          userId: `user-${timestamp}`,
          email: 'invalid-email-format',
          firstName: 'Invalid',
          lastName: 'Test',
        },
        temporaryPassword: '',
        companyName: 'Invalid Email Company',
      };

      const handle = await client.workflow.start(testEmailWorkflow, {
        args: [input],
        taskQueue: 'email-e2e-test-queue',
        workflowId: `email-invalid-${timestamp}`,
      });

      const result = await handle.result();

      // Password should still be generated
      expect(result.temporaryPassword).toBeDefined();
      expect(result.temporaryPassword).toHaveLength(12);

      // Email should fail gracefully
      expect(result.emailResult.emailSent).toBe(false);
      expect(result.emailResult.error).toBeDefined();
      expect(result.emailResult.error).toContain('Invalid email address');
    });

    it('should execute workflow with minimal required fields', async () => {
      const timestamp = Date.now();
      const input: SendWelcomeEmailActivityInput = {
        tenantId: `tenant-${timestamp}`,
        tenantName: 'Minimal Test Tenant',
        adminUser: {
          userId: `user-${timestamp}`,
          email: `minimal-${timestamp}@example.com`,
          firstName: 'Minimal',
          lastName: 'User',
        },
        temporaryPassword: '',
        // No companyName or loginUrl - should use defaults
      };

      const handle = await client.workflow.start(testEmailWorkflow, {
        args: [input],
        taskQueue: 'email-e2e-test-queue',
        workflowId: `email-minimal-${timestamp}`,
      });

      const result = await handle.result();

      // Should complete successfully with defaults
      expect(result.temporaryPassword).toBeDefined();
      expect(result.emailResult.emailSent).toBe(true);
      expect(result.emailResult.messageId).toBeDefined();
      expect(result.emailResult.error).toBeUndefined();
    });

    it('should handle multiple concurrent workflows', async () => {
      const timestamp = Date.now();
      const workflows = [];

      // Start 3 concurrent workflows
      for (let i = 0; i < 3; i++) {
        const input: SendWelcomeEmailActivityInput = {
          tenantId: `tenant-${timestamp}-${i}`,
          tenantName: `Concurrent Test Tenant ${i}`,
          adminUser: {
            userId: `user-${timestamp}-${i}`,
            email: `concurrent-${timestamp}-${i}@example.com`,
            firstName: `User${i}`,
            lastName: 'Test',
          },
          temporaryPassword: '',
          companyName: `Concurrent Company ${i}`,
        };

        const handle = await client.workflow.start(testEmailWorkflow, {
          args: [input],
          taskQueue: 'email-e2e-test-queue',
          workflowId: `email-concurrent-${timestamp}-${i}`,
        });

        workflows.push(handle);
      }

      // Wait for all workflows to complete
      const results = await Promise.all(workflows.map(h => h.result()));

      // Verify all workflows completed successfully
      results.forEach((result, index) => {
        expect(result.temporaryPassword).toBeDefined();
        expect(result.temporaryPassword).toHaveLength(12);
        expect(result.emailResult.emailSent).toBe(true);
        expect(result.emailResult.messageId).toBeDefined();
      });

      // Verify all passwords are unique
      const passwords = results.map(r => r.temporaryPassword);
      const uniquePasswords = new Set(passwords);
      expect(uniquePasswords.size).toBe(3);
    });
  });

  describe('Workflow Error Handling', () => {
    it('should complete workflow even if email fails', async () => {
      const timestamp = Date.now();
      const input: SendWelcomeEmailActivityInput = {
        tenantId: `tenant-${timestamp}`,
        tenantName: 'Error Handling Test',
        adminUser: {
          userId: `user-${timestamp}`,
          email: '', // Empty email to trigger error
          firstName: 'Error',
          lastName: 'Test',
        },
        temporaryPassword: '',
      };

      const handle = await client.workflow.start(testEmailWorkflow, {
        args: [input],
        taskQueue: 'email-e2e-test-queue',
        workflowId: `email-error-${timestamp}`,
      });

      // Workflow should complete without throwing
      const result = await handle.result();

      // Password generation should still work
      expect(result.temporaryPassword).toBeDefined();
      expect(result.temporaryPassword).toHaveLength(12);

      // Email should fail but not crash workflow
      expect(result.emailResult.emailSent).toBe(false);
      expect(result.emailResult.error).toBeDefined();
    });

    it('should handle activity timeouts gracefully', async () => {
      const timestamp = Date.now();
      const input: SendWelcomeEmailActivityInput = {
        tenantId: `tenant-${timestamp}`,
        tenantName: 'Timeout Test Tenant',
        adminUser: {
          userId: `user-${timestamp}`,
          email: `timeout-${timestamp}@example.com`,
          firstName: 'Timeout',
          lastName: 'Test',
        },
        temporaryPassword: '',
      };

      // Create workflow with short timeout to test timeout handling
      const handle = await client.workflow.start(testEmailWorkflow, {
        args: [input],
        taskQueue: 'email-e2e-test-queue',
        workflowId: `email-timeout-${timestamp}`,
        workflowExecutionTimeout: '10s', // Short timeout for testing
      });

      // Should complete within timeout
      const result = await handle.result();
      
      expect(result.temporaryPassword).toBeDefined();
      expect(result.emailResult).toBeDefined();
    });
  });
});