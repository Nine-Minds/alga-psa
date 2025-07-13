import { EmailSettingsTestContext } from './EmailSettingsTestContext';

/**
 * Optimized test fixture for email settings tests that minimizes database setup overhead
 */
export class EmailSettingsTestFixture {
  private static instance: EmailSettingsTestFixture | null = null;
  private context: EmailSettingsTestContext | null = null;
  private baseTestData: {
    tenant: any;
    company: any;
    contact: any;
  } | null = null;

  /**
   * Get singleton instance of the test fixture
   */
  static getInstance(): EmailSettingsTestFixture {
    if (!EmailSettingsTestFixture.instance) {
      EmailSettingsTestFixture.instance = new EmailSettingsTestFixture();
    }
    return EmailSettingsTestFixture.instance;
  }

  /**
   * Initialize the test fixture once - expensive operations done here
   */
  async initialize(options?: any): Promise<void> {
    if (this.context) {
      return; // Already initialized
    }

    console.log('🏗️ Initializing Email Settings Test Fixture (one-time setup)...');

    // Create and initialize the test context with provided options
    this.context = new EmailSettingsTestContext({
      testMode: 'e2e',
      autoStartServices: true,
      clearEmailsBeforeTest: false, // We'll handle this manually
      runSeeds: true,
      // Override with any provided options
      ...options
    });

    console.log('  📊 Setting up database and services...');
    await this.context.initialize();

    // Create base test data that will be reused across tests
    console.log('  🏢 Creating reusable base test data...');
    this.baseTestData = await this.context.emailTestFactory.createBasicEmailScenario();
    
    console.log(`     ✓ Base tenant: ${this.baseTestData.tenant.tenant}`);
    console.log(`     ✓ Base company: ${this.baseTestData.company.company_name}`);
    console.log(`     ✓ Base contact: ${this.baseTestData.contact.email}`);

    console.log('✅ Email Settings Test Fixture initialized successfully!\n');
  }

  /**
   * Get the test context (initialize if needed)
   */
  async getContext(): Promise<EmailSettingsTestContext> {
    await this.initialize();
    return this.context!;
  }

  /**
   * Get base test data (tenant, company, contact) that's shared across tests
   */
  getBaseTestData() {
    if (!this.baseTestData) {
      throw new Error('Test fixture not initialized. Call initialize() first.');
    }
    return this.baseTestData;
  }

  /**
   * Clean up between tests - only removes test-specific data, not base setup
   */
  async cleanupBetweenTests(): Promise<void> {
    if (!this.context) return;

    console.log('🧹 Cleaning up test-specific data...');

    // Clear emails
    if (this.context.mailhogClient) {
      await this.context.mailhogClient.clearMessages();
    }

    // Only clean up email providers created during tests (not base tenant/company/contact)
    const emailProviders = this.context.emailTestFactory.getCreatedResources().emailProviders;
    if (emailProviders.length > 0) {
      console.log(`  🗑️ Removing ${emailProviders.length} test email providers...`);
      await this.context.db('email_provider_configs')
        .whereIn('id', emailProviders)
        .del();
      
      // Clear the tracking array
      this.context.emailTestFactory.getCreatedResources().emailProviders = [];
    }

    // Clean up any additional test-specific tickets, workflows, etc.
    // But preserve the base tenant, company, and contact
    console.log('✅ Test-specific cleanup completed');
  }

  /**
   * Final cleanup - called once at the end of all tests
   */
  async cleanup(): Promise<void> {
    if (!this.context) return;

    console.log('🧹 Final test fixture cleanup...');
    
    // Clean up all test data including base data
    await this.context.emailTestFactory.cleanup();
    
    // Cleanup the context
    await this.context.cleanup();
    
    // Reset singleton
    EmailSettingsTestFixture.instance = null;
    this.context = null;
    this.baseTestData = null;
    
    console.log('✅ Test fixture fully cleaned up');
  }

  /**
   * Create test-specific email provider using base test data
   */
  async createTestEmailProvider(overrides: {
    provider: 'microsoft' | 'google';
    mailbox: string;
  }) {
    const context = await this.getContext();
    const baseData = this.getBaseTestData();

    console.log(`     📧 Creating ${overrides.provider} provider: ${overrides.mailbox}`);
    
    const provider = await context.createEmailProvider({
      provider: overrides.provider,
      mailbox: overrides.mailbox,
      tenant_id: baseData.tenant.tenant,
      company_id: baseData.company.company_id
    });

    // Track this provider for cleanup
    context.emailTestFactory.getCreatedResources().emailProviders.push(provider.id);
    
    return provider;
  }

  /**
   * Helper to create test helpers compatible with existing test structure
   */
  static createOptimizedHelpers() {
    const fixture = EmailSettingsTestFixture.getInstance();

    return {
      beforeAll: async (options?: any) => {
        await fixture.initialize(options);
        return await fixture.getContext();
      },

      afterAll: async () => {
        await fixture.cleanup();
      },

      beforeEach: async () => {
        // No expensive operations - just return context
        return await fixture.getContext();
      },

      afterEach: async () => {
        await fixture.cleanupBetweenTests();
      },

      // Helper methods for tests
      getBaseTestData: () => fixture.getBaseTestData(),
      createTestEmailProvider: (overrides: any) => fixture.createTestEmailProvider(overrides)
    };
  }
}