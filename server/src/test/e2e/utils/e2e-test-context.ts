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
      'DB_PORT': '5433',
      'DB_NAME_SERVER': 'server_test',
      'DB_USER_ADMIN': 'postgres',
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
      this.mailhogPollingService = new MailHogPollingService({
        pollIntervalMs: 1000, // Poll every second in tests
        mailhogApiUrl: 'http://localhost:8025/api/v1'
      });
      
      // Start Docker services if configured to do so
      if (this.e2eOptions.autoStartServices && this.e2eOptions.testMode === 'e2e') {
        try {
          await this.startE2EServices();
        } catch (error) {
          // If services are already running, that's fine
          console.log('⚠️ Service startup failed, but services may already be running:', error.message);
          
          // Try to wait for health checks anyway
          try {
            await this.dockerServices.waitForHealthChecks();
            console.log('✅ Services are healthy, continuing with existing services');
          } catch (healthError) {
            console.error('❌ Services are not healthy:', healthError.message);
            throw error; // Re-throw original error
          }
        }
      }
      
      console.log('✅ E2E Test Context initialized');
    } catch (error) {
      console.error('❌ Failed to initialize E2E Test Context:', error);
      throw error;
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
      await this.dockerServices.ensureServicesRunning();
      
      // Wait for services to be healthy
      await this.dockerServices.waitForHealthChecks();
      
      // Clear MailHog messages if configured
      if (this.e2eOptions.clearEmailsBeforeTest) {
        await this.mailhogClient.clearMessages();
      }
      
      // Start MailHog polling service if configured
      if (this.e2eOptions.autoStartEmailPolling) {
        console.log('📧 Starting MailHog email polling service...');
        this.mailhogPollingService.startPolling();
        console.log('✅ MailHog polling service started successfully');
      }
      
      this.servicesStarted = true;
      console.log('✅ E2E Docker services ready');
    } catch (error) {
      // Don't log the error here as docker-service-manager already handles it
      throw error;
    }
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
   * Waits for workflow processing to complete
   */
  async waitForWorkflowProcessing(timeoutMs: number = 30000): Promise<void> {
    if (!this.dockerServices) {
      throw new Error('Docker services not initialized');
    }
    
    await this.dockerServices.waitForWorkflowProcessing(timeoutMs);
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
    
    const sentEmail = await this.mailhogClient.sendEmail(emailData);
    const capturedEmail = await this.mailhogClient.waitForEmailCapture(sentEmail.messageId);
    
    return { sentEmail, capturedEmail };
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
}