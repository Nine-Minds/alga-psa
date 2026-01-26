import { TestContext, TestContextOptions } from '../../../../test-utils/testContext';
import { DockerServiceManager } from './docker-service-manager';
import { MailHogClient } from './mailhog-client';
import { EmailTestFactory } from './email-test-factory';
import { MailHogPollingService } from '../../../services/email/MailHogPollingService';

export interface E2ETestContextOptions extends TestContextOptions {
  /**
   * Test mode - affects how services are managed
   */
  testMode?: 'unit' | 'integration' | 'e2e';
  
  /**
   * Whether to automatically start Docker services
   * @default true
   */
  autoStartServices?: boolean;
  
  /**
   * Timeout for service startup (ms)
   * @default 120000
   */
  serviceStartupTimeout?: number;
  
  /**
   * Whether to clear MailHog messages before tests
   * @default true
   */
  clearEmailsBeforeTest?: boolean;
  
  /**
   * Whether to start MailHog polling service for automatic email processing
   * @default true
   */
  autoStartEmailPolling?: boolean;
}

/**
 * Extended TestContext for E2E tests with Docker service management
 */
export class E2ETestContext extends TestContext {
  public dockerServices!: DockerServiceManager;
  public mailhogClient!: MailHogClient;
  public emailTestFactory!: EmailTestFactory;
  public mailhogPollingService!: MailHogPollingService;
  private e2eOptions: E2ETestContextOptions;
  private servicesStarted: boolean = false;
  private originalEnvVars: Record<string, string | undefined> = {};

  constructor(options: E2ETestContextOptions = {}) {
    const e2eDefaults = {
      testMode: 'e2e' as const,
      autoStartServices: true,
      serviceStartupTimeout: 120000,
      clearEmailsBeforeTest: true,
      autoStartEmailPolling: true,
      cleanupTables: [
        'tickets',
        'contacts', 
        'email_providers',
        'workflow_events',
        'email_messages',
        'attachments',
        'workflow_definitions',
        'workflow_instances',
        ...options.cleanupTables || []
      ]
    };

    super({ ...e2eDefaults, ...options });
    this.e2eOptions = { ...e2eDefaults, ...options };
  }

  /**
   * Sets E2E-specific environment variables
   */
  private setE2EEnvironmentVariables(): void {
    // Store original values for restoration later
    const e2eEnvVars = {
      'DB_HOST': 'localhost',
      'DB_PORT': '5433',  // Use direct postgres port for admin operations (migrations, seeds)
      'DB_NAME_SERVER': 'server_test',
      'DB_USER_ADMIN': 'postgres',  // Use postgres user for admin operations
      'PGBOUNCER_HOST': 'localhost',
      'PGBOUNCER_PORT': '6434',
      'REDIS_HOST': 'localhost',
      'REDIS_PORT': '6380',
      'EMAIL_HOST': 'localhost',
      'EMAIL_PORT': '1025'
    };

    for (const [key, value] of Object.entries(e2eEnvVars)) {
      this.originalEnvVars[key] = process.env[key];
      process.env[key] = value;
    }

    console.log('🔧 Set E2E environment variables:', e2eEnvVars);
  }

  /**
   * Restores original environment variables
   */
  private restoreEnvironmentVariables(): void {
    for (const [key, originalValue] of Object.entries(this.originalEnvVars)) {
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
  }

  /**
   * Initializes the E2E test context including Docker services
   */
  async initialize(): Promise<void> {
    console.log('🚀 Initializing E2E Test Context...');
    
    try {
      // Set E2E-specific environment variables before initializing database
      this.setE2EEnvironmentVariables();
      
      // Initialize base test context (database, test data, etc.)
      await super.initialize();
      
      // Initialize E2E services
      this.dockerServices = new DockerServiceManager();
      this.mailhogClient = new MailHogClient();
      this.emailTestFactory = new EmailTestFactory(this);
      
      // We'll use whatever tenant is available (will be determined by EmailTestFactory)
      // Using a fallback default that will be replaced when EmailTestFactory runs
      const testTenantId = '27460c9d-9eb9-45d8-9b99-a69c52df2136';
      console.log(`🆔 E2ETestContext initialized with default tenant ID: ${testTenantId}`);
      
      this.mailhogPollingService = new MailHogPollingService({
        pollIntervalMs: 1000, // Poll every second in tests
        mailhogApiUrl: 'http://localhost:8025/api/v1',
        defaultTenantId: testTenantId
      });
      
      // Start Docker services if configured to do so
      console.log(`🔍 Debug: autoStartServices = ${this.e2eOptions.autoStartServices}, testMode = ${this.e2eOptions.testMode}`);
      if (this.e2eOptions.autoStartServices && this.e2eOptions.testMode === 'e2e') {
        console.log('🔍 Debug: Starting E2E services...');
        try {
          await this.startE2EServices();
        } catch (error) {
          // If services are already running, that's fine
          console.log('⚠️ Service startup failed, but services may already be running:', error.message);
          
          // Try to wait for health checks anyway
          try {
            await this.dockerServices.waitForHealthChecks();
            console.log('✅ Services are healthy, continuing with existing services');
            
            // Still need to start polling service and clear emails even if Docker services were already running
            await this.startSupportingServices();
          } catch (healthError) {
            console.error('❌ Services are not healthy:', healthError.message);
            throw error; // Re-throw original error
          }
        }
      } else if (this.e2eOptions.testMode === 'e2e') {
        // Even if not auto-starting Docker services, we still need supporting services
        await this.startSupportingServices();
      }
      
      console.log('✅ E2E Test Context initialized');
    } catch (error) {
      console.error('❌ Failed to initialize E2E Test Context:', error);
      throw error;
    }
  }

  /**
   * Start supporting services (polling, email clearing) regardless of Docker status
   */
  async startSupportingServices(): Promise<void> {
    console.log('🔧 Starting supporting services...');
    
    // Clear MailHog messages if configured
    if (this.e2eOptions.clearEmailsBeforeTest) {
      await this.mailhogClient.clearMessages();
      console.log('🧹 MailHog messages cleared');
    }
    
    // Start MailHog polling service if configured
    if (this.e2eOptions.autoStartEmailPolling) {
      console.log('📧 Starting MailHog email polling service...');
      this.mailhogPollingService.startPolling();
      console.log('✅ MailHog polling service started');
    }
  }

  /**
   * Starts E2E Docker services
   */
  async startE2EServices(): Promise<void> {
    if (this.servicesStarted) {
      console.log('ℹ️ E2E services already started');
      return;
    }

    console.log('🐳 Starting E2E Docker services...');
    
    try {
      // Ensure services are running (start if needed)
      console.log('🔍 Debug: Ensuring services are running...');
      await this.dockerServices.ensureServicesRunning();
      
      // Wait for services to be healthy
      console.log('🔍 Debug: Waiting for health checks...');
      await this.dockerServices.waitForHealthChecks();
      
      // Start supporting services (polling, clearing)
      await this.startSupportingServices();
      
      this.servicesStarted = true;
      console.log('✅ E2E Docker services ready');
    } catch (error) {
      // Don't log the error here as docker-service-manager already handles it
      throw error;
    }
  }

  /**
   * Complete the service setup (MailHog polling, etc.)
   */
  private async completeServiceSetup(): Promise<void> {
    // Clear MailHog messages if configured
    console.log('🔍 Debug: Clearing MailHog messages...');
    if (this.e2eOptions.clearEmailsBeforeTest) {
      await this.mailhogClient.clearMessages();
    }
    
    // Start MailHog polling service if configured
    console.log(`🔍 Debug: autoStartEmailPolling = ${this.e2eOptions.autoStartEmailPolling}`);
    if (this.e2eOptions.autoStartEmailPolling) {
      console.log('📧 Starting MailHog email polling service...');
      this.mailhogPollingService.startPolling();
      console.log('✅ MailHog polling service started successfully');
    } else {
      console.log('⚠️ MailHog polling service NOT started (autoStartEmailPolling = false)');
    }
    
    this.servicesStarted = true;
    console.log('✅ E2E Docker services ready');
  }

  /**
   * Stops E2E Docker services
   */
  async stopE2EServices(): Promise<void> {
    if (!this.servicesStarted) {
      return;
    }

    console.log('🛑 Stopping E2E Docker services...');
    
    try {
      // Stop MailHog polling service
      if (this.mailhogPollingService) {
        this.mailhogPollingService.stopPolling();
      }
      
      await this.dockerServices.stopE2EServices();
      this.servicesStarted = false;
      console.log('✅ E2E Docker services stopped');
    } catch (error) {
      console.error('❌ Failed to stop E2E services:', error);
      throw error;
    }
  }

  /**
   * Performs E2E-specific cleanup
   */
  async cleanupE2E(): Promise<void> {
    console.log('🧹 Performing E2E cleanup...');
    
    try {
      // Clean up test data through EmailTestFactory
      await this.emailTestFactory.cleanup();
      
      // Clear MailHog messages
      if (this.mailhogClient) {
        await this.mailhogClient.clearMessages();
      }
      
      console.log('✅ E2E cleanup completed');
    } catch (error) {
      console.error('❌ Error during E2E cleanup:', error);
      throw error;
    }
  }

  /**
   * Gets the status of all E2E services
   */
  async getServicesStatus(): Promise<Record<string, any>> {
    if (!this.dockerServices) {
      return { error: 'Docker services not initialized' };
    }
    
    return await this.dockerServices.getServiceStatus();
  }

  /**
   * Sends a test email and waits for it to be captured
   */
  async sendAndCaptureEmail(emailData: {
    from: string;
    to: string;
    subject: string;
    body: string;
    attachments?: any[];
  }): Promise<{ sentEmail: any; capturedEmail: any }> {
    if (!this.mailhogClient) {
      throw new Error('MailHog client not initialized');
    }
    
    // Update MailHog polling service with current test tenant
    if (this.mailhogPollingService) {
      // Use the test context's tenant ID directly instead of querying
      const testTenantId = this.tenantId;
      console.log(`🔄 Updating MailHog polling service to use test tenant: ${testTenantId}`);
      this.mailhogPollingService.defaultTenantId = testTenantId;
    }
    
    const sentEmail = await this.mailhogClient.sendEmail(emailData);
    const capturedEmail = await this.mailhogClient.waitForEmailCapture(sentEmail.messageId);
    
    return { sentEmail, capturedEmail };
  }

  /**
   * Wait for workflow processing to complete for email-to-ticket conversion
   */
  async waitForWorkflowProcessing(timeout: number = 15000): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 1000; // Poll every second

    console.log('⏳ Waiting for workflow processing to complete...');

    while (Date.now() - startTime < timeout) {
      try {
        // Check for new tickets (using correct column name)
        const recentTickets = await this.db('tickets')
          .where('entered_at', '>', new Date(startTime)) // Use entered_at instead of created_at
          .count('* as count')
          .first();

        console.log(`📊 Tickets created: ${recentTickets.count}`);

        // If we have tickets created, workflow processing is likely complete
        if (parseInt(recentTickets.count) > 0) {
          console.log('✅ Workflow processing appears to be complete (tickets created)');
          // Wait a bit more for any final processing
          await new Promise(resolve => setTimeout(resolve, 2000));
          return;
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));

      } catch (error) {
        console.error('❌ Error polling for workflow processing:', error);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    console.log('⏳ Workflow processing timeout reached, assuming completion');
  }

  /**
   * Creates a helper object with common E2E operations
   */
  static createE2EHelpers() {
    return {
      beforeAll: async (options: E2ETestContextOptions = {}) => {
        const context = new E2ETestContext(options);
        await context.initialize();
        return context;
      },
      
      afterAll: async (context: E2ETestContext) => {
        try {
          // Only clean up if context was properly initialized
          if (context && context.cleanupE2E) {
            // Clean up E2E specific resources
            await context.cleanupE2E();
            
            // Stop services (but don't error if they're already stopped)
            try {
              await context.stopE2EServices();
            } catch (error) {
              console.warn('⚠️ Warning during service cleanup:', error.message);
            }
            
            // Clean up base test context
            await context.cleanup();
          }
        } catch (error) {
          console.error('❌ Error during E2E test cleanup:', error);
          throw error;
        }
      },
      
      beforeEach: async (context: E2ETestContext) => {
        // Ensure services are still running
        if (context.e2eOptions.testMode === 'e2e') {
          const status = await context.getServicesStatus();
          const unhealthyServices = Object.entries(status)
            .filter(([name, info]: [string, any]) => !info.healthy)
            .map(([name]) => name);
          
          if (unhealthyServices.length > 0) {
            console.warn(`⚠️ Unhealthy services detected: ${unhealthyServices.join(', ')}`);
            // Optionally restart services here
          }
        }
        
        // Clear emails before each test
        if (context.e2eOptions.clearEmailsBeforeTest && context.mailhogClient) {
          await context.mailhogClient.clearMessages();
        }
        
        // Clear MailHog polling service processed history
        if (context.mailhogPollingService) {
          context.mailhogPollingService.clearProcessedHistory();
        }
        
        // Clear Redis workflow event stream to prevent processing old events
        await context.clearWorkflowEventStream();
      },
      
      afterEach: async (context: E2ETestContext) => {
        // Clean up test data after each test
        await context.emailTestFactory.cleanup();
      }
    };
  }

  /**
   * Override cleanup to include E2E cleanup
   */
  async cleanup(): Promise<void> {
    await this.cleanupE2E();
    this.restoreEnvironmentVariables();
    await super.cleanup();
  }
  
  /**
   * Clear the workflow event stream in Redis
   */
  async clearWorkflowEventStream(): Promise<void> {
    try {
      const { createClient } = await import('redis');
      const { getSecret } = await import('@alga-psa/core');
      
      const password = await getSecret('redis_password', 'REDIS_PASSWORD');
      const client = createClient({
        url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
        password
      });
      
      await client.connect();
      
      // Delete and recreate the stream to ensure a clean slate
      try {
        await client.del('workflow:events:global');
        console.log('🧹 Deleted workflow event stream');
      } catch (delError: any) {
        console.log('ℹ️ Could not delete workflow event stream:', delError.message);
      }
      
      // Create a fresh consumer group
      try {
        await client.xGroupCreate('workflow:events:global', 'workflow-processors', '0', {
          MKSTREAM: true
        });
        console.log('✅ Created fresh workflow consumer group');
      } catch (err: any) {
        if (err.message.includes('BUSYGROUP')) {
          // This shouldn't happen since we just deleted the stream
          console.log('⚠️ Consumer group already exists after stream deletion');
        } else {
          throw err;
        }
      }
      
      await client.quit();
    } catch (error) {
      console.warn('⚠️ Failed to clear workflow event stream:', error.message);
    }
  }
}