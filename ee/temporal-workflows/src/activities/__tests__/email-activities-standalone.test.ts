import { describe, it, expect, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
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

describe('Email Activities - Standalone Tests', () => {
  describe('Password Generation', () => {
    it('should generate secure passwords with default length', async () => {
      const password = await generateTemporaryPassword();
      expect(password).toHaveLength(12);
      
      // Check for required character types
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[2-9]/);
      expect(password).toMatch(/[!@#$%^&*]/);
      
      // Should not contain ambiguous characters
      expect(password).not.toMatch(/[0O1lI]/);
    });

    it('should generate passwords with custom length', async () => {
      const password = await generateTemporaryPassword(16);
      expect(password).toHaveLength(16);
      
      // Should still meet security requirements
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[2-9]/);
      expect(password).toMatch(/[!@#$%^&*]/);
    });

    it('should generate unique passwords', async () => {
      const passwords = await Promise.all(
        Array.from({ length: 10 }, () => generateTemporaryPassword(12)),
      );
      const uniquePasswords = new Set(passwords);
      expect(uniquePasswords.size).toBe(10);
    });
  });

  describe('Email Activity', () => {
    it('should send welcome email successfully', async () => {
      const tenantId = uuidv4();
      const userId = uuidv4();
      const input: SendWelcomeEmailActivityInput = {
        tenantId,
        tenantName: 'Test Tenant',
        adminUser: {
          userId,
          email: `test-${tenantId}@example.com`,
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

    it('should handle invalid email gracefully', async () => {
      const tenantId = uuidv4();
      const userId = uuidv4();
      const input: SendWelcomeEmailActivityInput = {
        tenantId,
        tenantName: 'Test Tenant',
        adminUser: {
          userId,
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

    it('should work with minimal required fields', async () => {
      const tenantId = uuidv4();
      const userId = uuidv4();
      const input: SendWelcomeEmailActivityInput = {
        tenantId,
        tenantName: 'Minimal Tenant',
        adminUser: {
          userId,
          email: `minimal-${tenantId}@example.com`,
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

  describe('Mock Email Service Integration', () => {
    it('should validate email service templates', () => {
      const mockService = new MockEmailService();
      
      const template = mockService.getEmailTemplate('tenant_welcome');
      expect(template).toBeDefined();
      expect(template?.name).toBe('tenant_welcome');
      expect(template?.subject).toContain('{{tenantName}}');
      expect(template?.variables).toContain('firstName');
      expect(template?.variables).toContain('tenantName');
      expect(template?.variables).toContain('temporaryPassword');
      expect(template?.variables).toContain('loginUrl');
    });

    it('should handle unknown templates', () => {
      const mockService = new MockEmailService();
      
      const template = mockService.getEmailTemplate('unknown_template');
      expect(template).toBeNull();
    });
  });
});
