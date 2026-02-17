import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateTemporaryPassword } from '../email-activities';
import { MockEmailService, createEmailService, type EmailParams } from '../../services/email-service';

// Mock the Context from @temporalio/activity
vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    }),
  },
}));

describe('Email Activities - Simple Tests', () => {
  describe('generateTemporaryPassword', () => {
    it('should generate password with default length of 12', async () => {
      const password = await generateTemporaryPassword();
      expect(password).toHaveLength(12);
    });

    it('should generate password with custom length', async () => {
      const password = await generateTemporaryPassword(16);
      expect(password).toHaveLength(16);
    });

    it('should generate different passwords each time', async () => {
      const password1 = await generateTemporaryPassword();
      const password2 = await generateTemporaryPassword();
      expect(password1).not.toBe(password2);
    });

    it('should contain at least one character from each category', async () => {
      const password = await generateTemporaryPassword(12);
      
      // Check for uppercase
      expect(password).toMatch(/[A-Z]/);
      
      // Check for lowercase
      expect(password).toMatch(/[a-z]/);
      
      // Check for numbers
      expect(password).toMatch(/[0-9]/);
      
      // Check for special characters
      expect(password).toMatch(/[!@#$%^&*]/);
    });

    it('should not contain ambiguous characters', async () => {
      const password = await generateTemporaryPassword(100); // Large sample
      
      // Should not contain 0, O, 1, l, I
      expect(password).not.toMatch(/[0O1lI]/);
    });

    it('should handle minimum length of 4', async () => {
      const password = await generateTemporaryPassword(4);
      expect(password).toHaveLength(4);
      
      // Should still have one of each type
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[!@#$%^&*]/);
    });

    it('should generate secure passwords with high entropy', async () => {
      // Generate multiple passwords and check uniqueness
      const passwords = new Set();
      for (let i = 0; i < 100; i++) {
        passwords.add(await generateTemporaryPassword(12));
      }
      
      // All 100 passwords should be unique
      expect(passwords.size).toBe(100);
    });
  });

  describe('MockEmailService', () => {
    let mockEmailService: MockEmailService;

    beforeEach(() => {
      mockEmailService = new MockEmailService();
    });

    it('should send emails successfully', async () => {
      const emailParams: EmailParams = {
        to: 'test@example.com',
        subject: 'Test Email',
        html: '<h1>Test</h1>',
        text: 'Test',
      };

      const result = await mockEmailService.sendEmail(emailParams);

      expect(result.messageId).toBeDefined();
      expect(result.accepted).toEqual(['test@example.com']);
      expect(result.rejected).toEqual([]);
    });

    it('should validate email addresses correctly', () => {
      // Valid emails
      expect(mockEmailService.validateEmail('user@example.com')).toBe(true);
      expect(mockEmailService.validateEmail('test.email+tag@domain.co.uk')).toBe(true);
      expect(mockEmailService.validateEmail('user123@test-domain.org')).toBe(true);
      
      // Invalid emails
      expect(mockEmailService.validateEmail('invalid-email')).toBe(false);
      expect(mockEmailService.validateEmail('user@')).toBe(false);
      expect(mockEmailService.validateEmail('@domain.com')).toBe(false);
      expect(mockEmailService.validateEmail('user@domain')).toBe(false);
      expect(mockEmailService.validateEmail('')).toBe(false);
    });

    it('should track sent emails for testing', async () => {
      const emailParams: EmailParams = {
        to: 'test1@example.com',
        subject: 'Test Email 1',
        html: '<h1>Test 1</h1>',
      };

      await mockEmailService.sendEmail(emailParams);
      await mockEmailService.sendEmail({
        ...emailParams,
        to: 'test2@example.com',
        subject: 'Test Email 2',
      });

      const sentEmails = mockEmailService.getSentEmails();
      expect(sentEmails).toHaveLength(2);
      expect(sentEmails[0].to).toBe('test1@example.com');
      expect(sentEmails[1].to).toBe('test2@example.com');
    });

    it('should filter emails by recipient', async () => {
      await mockEmailService.sendEmail({
        to: 'user1@example.com',
        subject: 'Email to User 1',
        text: 'Hello User 1',
      });

      await mockEmailService.sendEmail({
        to: 'user2@example.com',
        subject: 'Email to User 2',
        text: 'Hello User 2',
      });

      await mockEmailService.sendEmail({
        to: 'user1@example.com',
        subject: 'Another Email to User 1',
        text: 'Hello again User 1',
      });

      const user1Emails = mockEmailService.getEmailsTo('user1@example.com');
      const user2Emails = mockEmailService.getEmailsTo('user2@example.com');

      expect(user1Emails).toHaveLength(2);
      expect(user2Emails).toHaveLength(1);
      expect(user1Emails[0].subject).toBe('Email to User 1');
      expect(user1Emails[1].subject).toBe('Another Email to User 1');
    });

    it('should simulate failures when configured', async () => {
      mockEmailService.setFailureRate(1); // 100% failure rate

      const emailParams: EmailParams = {
        to: 'test@example.com',
        subject: 'Test Email',
        text: 'This should fail',
      };

      await expect(mockEmailService.sendEmail(emailParams)).rejects.toThrow(
        'Mock email service failure (simulated)'
      );
    });

    it('should handle invalid email addresses', async () => {
      const emailParams: EmailParams = {
        to: ['valid@example.com', 'invalid-email'], // Mix of valid and invalid
        subject: 'Test Email',
        text: 'Test',
      };

      const result = await mockEmailService.sendEmail(emailParams);

      expect(result.accepted).toEqual(['valid@example.com']);
      expect(result.rejected).toEqual(['invalid-email']);
    });

    it('should handle multiple recipients', async () => {
      const emailParams: EmailParams = {
        to: ['valid@example.com', 'invalid-email', 'another@example.com'],
        subject: 'Test Email',
        text: 'Test',
      };

      const result = await mockEmailService.sendEmail(emailParams);

      expect(result.accepted).toEqual(['valid@example.com', 'another@example.com']);
      expect(result.rejected).toEqual(['invalid-email']);
    });

    it('should throw error when no valid recipients', async () => {
      const emailParams: EmailParams = {
        to: ['invalid-email-1', 'invalid-email-2'],
        subject: 'Test Email',
        text: 'Test',
      };

      await expect(mockEmailService.sendEmail(emailParams)).rejects.toThrow(
        'No valid email addresses provided'
      );
    });

    it('should support email service configuration', async () => {
      const service = await createEmailService({ 
        provider: 'mock',
        options: { failureRate: 0.5, delayMs: 200 }
      });
      
      expect(service).toBeInstanceOf(MockEmailService);
    });

    it('should return email templates for testing', () => {
      const template = mockEmailService.getEmailTemplate('tenant_welcome');
      
      expect(template).toBeDefined();
      expect(template?.name).toBe('tenant_welcome');
      expect(template?.subject).toContain('{{tenantName}}');
      expect(template?.variables).toContain('firstName');
      expect(template?.variables).toContain('tenantName');
    });

    it('should return null for unknown templates', () => {
      const template = mockEmailService.getEmailTemplate('unknown_template');
      expect(template).toBeNull();
    });

    it('should support clearing sent emails', async () => {
      await mockEmailService.sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        text: 'Test',
      });

      expect(mockEmailService.getEmailCount()).toBe(1);
      
      mockEmailService.clearSentEmails();
      
      expect(mockEmailService.getEmailCount()).toBe(0);
      expect(mockEmailService.getSentEmails()).toHaveLength(0);
    });

    it('should handle delay configuration', async () => {
      mockEmailService.setDelay(100);
      
      const startTime = Date.now();
      await mockEmailService.sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        text: 'Test',
      });
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeGreaterThanOrEqual(90); // Allow some tolerance
    });
  });

  describe('Email Service Factory', () => {
    it('should create mock service by default', async () => {
      const service = await createEmailService();
      expect(service).toBeInstanceOf(MockEmailService);
    });

    it('should create mock service when explicitly requested', async () => {
      const service = await createEmailService({ provider: 'mock' });
      expect(service).toBeInstanceOf(MockEmailService);
    });

    it('should throw error for unknown providers', async () => {
      await expect(createEmailService({ provider: 'unknown' as any })).rejects.toThrow(
        'Unknown email provider: unknown'
      );
    });

    it('should pass options to mock service', async () => {
      const service = await createEmailService({
        provider: 'mock',
        options: { failureRate: 0.5 }
      }) as MockEmailService;

      expect(service).toBeInstanceOf(MockEmailService);
    });
  });
});
