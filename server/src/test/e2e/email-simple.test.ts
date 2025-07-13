import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import '../../../test-utils/nextApiMock';
import { E2ETestContext } from './utils/e2e-test-context';

describe('Simple Email E2E Tests', () => {
  const testHelpers = E2ETestContext.createE2EHelpers();
  let context: E2ETestContext;

  beforeAll(async () => {
    context = await testHelpers.beforeAll({
      runSeeds: true,
      testMode: 'e2e',
      autoStartServices: true,
      clearEmailsBeforeTest: true
    });
  });

  afterAll(async () => {
    await testHelpers.afterAll(context);
  });

  beforeEach(async () => {
    await testHelpers.beforeEach(context);
  });

  afterEach(async () => {
    await testHelpers.afterEach(context);
  });

  describe('Email Infrastructure', () => {
    it('should send and capture emails via MailHog', async () => {
      // Arrange
      const testEmail = {
        from: 'test@example.com',
        to: 'support@company.com',
        subject: 'Simple Test Email',
        body: 'This is a simple test to verify email capture.'
      };

      // Act
      const { sentEmail, capturedEmail } = await context.sendAndCaptureEmail(testEmail);

      // Assert
      expect(sentEmail).toBeDefined();
      expect(sentEmail.messageId).toBeDefined();
      expect(capturedEmail).toBeDefined();
      expect(capturedEmail.Content.Headers.Subject[0]).toBe(testEmail.subject);
      expect(capturedEmail.Content.Body).toContain(testEmail.body);
    });

    it('should create test data successfully', async () => {
      // Arrange & Act
      const { tenant, company, contact } = await context.emailTestFactory.createBasicEmailScenario();

      // Assert
      expect(tenant.tenant).toBeDefined();
      expect(company.company_id).toBeDefined();
      expect(contact.contact_name_id).toBeDefined();
      expect(contact.email).toBe('test.customer@example.com');

      // Verify data exists in database
      const dbTenant = await context.db('tenants').where('tenant', tenant.tenant).first();
      expect(dbTenant).toBeDefined();

      const dbCompany = await context.db('companies').where('company_id', company.company_id).first();
      expect(dbCompany).toBeDefined();

      const dbContact = await context.db('contacts').where('contact_name_id', contact.contact_name_id).first();
      expect(dbContact).toBeDefined();
      expect(dbContact.email).toBe(contact.email);
    });

    it('should verify workflow worker is healthy', async () => {
      // Act
      const health = await context.dockerServices.getServiceStatus();

      // Assert
      expect(health['workflow-worker']).toBeDefined();
      expect(health['workflow-worker'].healthy).toBe(true);
      expect(health['mailhog']).toBeDefined();
      expect(health['mailhog'].healthy).toBe(true);
    });
  });
});