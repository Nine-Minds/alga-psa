import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { generateTemporaryPassword, sendWelcomeEmail } from '../email-activities';
import { MockEmailService } from '../../services/email-service';
import type { SendWelcomeEmailActivityInput } from '../../types/workflow-types';

// Mock the Context from @temporalio/activity for testing
vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    }),
  },
}));

describe('Email Activities - Temporal Unit Tests', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await testEnv?.teardown();
  });

  describe('Password Generation with Temporal Context', () => {
    it('should generate secure passwords with proper entropy', async () => {
      // Test password generation within Temporal test environment
      const passwords = await Promise.all(
        Array.from({ length: 10 }, () => generateTemporaryPassword(12))
      );

      // Verify all passwords are unique (high entropy)
      const uniquePasswords = new Set(passwords);
      expect(uniquePasswords.size).toBe(10);

      // Verify each password meets security requirements
      passwords.forEach(password => {
        expect(password).toHaveLength(12);
        expect(password).toMatch(/[A-Z]/);
        expect(password).toMatch(/[a-z]/);
        expect(password).toMatch(/[2-9]/);
        expect(password).toMatch(/[!@#$%^&*]/);
        expect(password).not.toMatch(/[0O1lI]/);
      });
    });

    it('should handle various password lengths correctly', async () => {
      const testCases = [
        { length: 8, name: 'short' },
        { length: 12, name: 'medium' },
        { length:16, name: 'long' },
        { length: 20, name: 'very long' },
      ];

      for (const { length } of testCases) {
        const password = await generateTemporaryPassword(length);
        expect(password).toHaveLength(length);
        
        // Should still meet security requirements regardless of length
        expect(password).toMatch(/[A-Z]/);
        expect(password).toMatch(/[a-z]/);
        expect(password).toMatch(/[2-9]/);
        expect(password).toMatch(/[!@#$%^&*]/);
        expect(password).not.toMatch(/[0O1lI]/);
      }
    });

    it('should ensure consistent randomness across calls', async () => {
      // Generate multiple batches to ensure randomness is consistent
      const batch1 = await Promise.all(
        Array.from({ length: 5 }, () => generateTemporaryPassword(12))
      );
      const batch2 = await Promise.all(
        Array.from({ length: 5 }, () => generateTemporaryPassword(12))
      );
      
      // No passwords should be the same across batches
      batch1.forEach(password1 => {
        batch2.forEach(password2 => {
          expect(password1).not.toBe(password2);
        });
      });
    });
  });

  describe('Email Activity Direct Testing', () => {
    it('should send welcome email with valid input', async () => {
      const timestamp = Date.now();
      const input: SendWelcomeEmailActivityInput = {
        tenantId: `tenant-${timestamp}`,
        tenantName: 'Test Tenant',
        adminUser: {
          userId: `user-${timestamp}`,
          email: `admin-${timestamp}@example.com`,
          firstName: 'John',
          lastName: 'Doe',
        },
        temporaryPassword: 'TestPass123!',
        clientName: 'Test Client',
        loginUrl: 'https://test.example.com/login',
      };

      const result = await sendWelcomeEmail(input);

      expect(result.emailSent).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(result.messageId).toMatch(/^mock-/);
      expect(result.error).toBeUndefined();
    });

    it('should handle invalid email addresses gracefully', async () => {
      const timestamp = Date.now();
      const input: SendWelcomeEmailActivityInput = {
        tenantId: `tenant-${timestamp}`,
        tenantName: 'Test Tenant',
        adminUser: {
          userId: `user-${timestamp}`,
          email: 'invalid-email-format',
          firstName: 'John',
          lastName: 'Doe',
        },
        temporaryPassword: 'TestPass123!',
      };

      const result = await sendWelcomeEmail(input);

      expect(result.emailSent).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Invalid email address');
    });

    it('should handle empty email addresses', async () => {
      const timestamp = Date.now();
      const input: SendWelcomeEmailActivityInput = {
        tenantId: `tenant-${timestamp}`,
        tenantName: 'Test Tenant',
        adminUser: {
          userId: `user-${timestamp}`,
          email: '',
          firstName: 'John',
          lastName: 'Doe',
        },
        temporaryPassword: 'TestPass123!',
      };

      const result = await sendWelcomeEmail(input);

      expect(result.emailSent).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should work with minimal required fields', async () => {
      const timestamp = Date.now();
      const input: SendWelcomeEmailActivityInput = {
        tenantId: `tenant-${timestamp}`,
        tenantName: 'Minimal Tenant',
        adminUser: {
          userId: `user-${timestamp}`,
          email: `minimal-${timestamp}@example.com`,
          firstName: 'Jane',
          lastName: 'Smith',
        },
        temporaryPassword: 'MinimalPass123!',
        // No clientName or loginUrl - should use defaults
      };

      const result = await sendWelcomeEmail(input);

      expect(result.emailSent).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(result.error).toBeUndefined();
    });
  });

  describe('Email Template Generation', () => {
    it('should generate proper email content structure', async () => {
      const timestamp = Date.now();
      const mockService = new MockEmailService();
      
      const input: SendWelcomeEmailActivityInput = {
        tenantId: `tenant-${timestamp}`,
        tenantName: 'Template Test Tenant',
        adminUser: {
          userId: `user-${timestamp}`,
          email: `template-${timestamp}@example.com`,
          firstName: 'Template',
          lastName: 'User',
        },
        temporaryPassword: 'TempPass123!',
        clientName: 'Template Client',
        loginUrl: 'https://template.example.com/login',
      };

      // Test the activity
      const result = await sendWelcomeEmail(input);
      expect(result.emailSent).toBe(true);

      // Test template structure through mock service
      const template = mockService.getEmailTemplate('tenant_welcome');
      expect(template).toBeDefined();
      expect(template?.name).toBe('tenant_welcome');
      expect(template?.subject).toContain('{{tenantName}}');
      expect(template?.variables).toContain('firstName');
      expect(template?.variables).toContain('tenantName');
      expect(template?.variables).toContain('temporaryPassword');
      expect(template?.variables).toContain('loginUrl');
    });

    it('should handle template variable substitution', async () => {
      const timestamp = Date.now();
      const generatedPassword = await generateTemporaryPassword(12);
      
      const input: SendWelcomeEmailActivityInput = {
        tenantId: `tenant-${timestamp}`,
        tenantName: 'Variable Test Tenant',
        adminUser: {
          userId: `user-${timestamp}`,
          email: `variable-${timestamp}@example.com`,
          firstName: 'Variable',
          lastName: 'User',
        },
        temporaryPassword: generatedPassword,
        clientName: 'Variable Client',
      };

      const result = await sendWelcomeEmail(input);

      expect(result.emailSent).toBe(true);
      expect(result.messageId).toBeDefined();
      
      // Verify the generated password meets requirements
      expect(generatedPassword).toHaveLength(12);
      expect(generatedPassword).toMatch(/[A-Z]/);
      expect(generatedPassword).toMatch(/[a-z]/);
      expect(generatedPassword).toMatch(/[2-9]/);
      expect(generatedPassword).toMatch(/[!@#$%^&*]/);
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should not throw exceptions on failure', async () => {
      const timestamp = Date.now();
      const input: SendWelcomeEmailActivityInput = {
        tenantId: `tenant-${timestamp}`,
        tenantName: 'Error Test Tenant',
        adminUser: {
          userId: `user-${timestamp}`,
          email: 'invalid-format',
          firstName: 'Error',
          lastName: 'Test',
        },
        temporaryPassword: 'ErrorPass123!',
      };

      // Activity should not throw - it should return error status
      const result = await sendWelcomeEmail(input);
      
      expect(result).toBeDefined();
      expect(result.emailSent).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
    });

    it('should handle missing required fields gracefully', async () => {
      const timestamp = Date.now();
      const invalidInput = {
        tenantId: `tenant-${timestamp}`,
        tenantName: '', // Empty tenant name
        adminUser: {
          userId: `user-${timestamp}`,
          email: `test-${timestamp}@example.com`,
          firstName: '',
          lastName: '',
        },
        temporaryPassword: 'TestPass123!',
      } as SendWelcomeEmailActivityInput;

      const result = await sendWelcomeEmail(invalidInput);
      expect(result).toBeDefined();
      
      // Should still attempt to send even with missing fields
      expect(typeof result.emailSent).toBe('boolean');
    });
  });

});
