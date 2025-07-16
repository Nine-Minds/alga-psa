import { E2ETestContext, E2ETestContextOptions } from './e2e-test-context';

/**
 * Persistent Test Context
 * 
 * Optimized E2E test context that assumes services are already running
 * and only manages data cleanup between tests, not service lifecycle.
 */
export class PersistentE2ETestContext extends E2ETestContext {
  
  /**
   * Create E2E helpers optimized for persistent test harness
   */
  static createPersistentE2EHelpers() {
    return {
      beforeAll: async (options: E2ETestContextOptions = {}) => {
        console.log('🧪 Initializing persistent E2E test context...');
        
        const optimizedOptions: E2ETestContextOptions = {
          runSeeds: true,
          testMode: 'e2e',
          autoStartServices: false,        // Services already running
          clearEmailsBeforeTest: true,
          autoStartEmailPolling: true,     // Start polling since services are running
          serviceStartupTimeout: 5000,    // Short timeout since services should be ready
          ...options
        };

        const context = new PersistentE2ETestContext();
        await context.initialize(optimizedOptions);
        
        // Quick health check to ensure services are available
        await context.verifyServicesRunning();
        
        console.log('✅ Persistent E2E test context ready');
        return context;
      },

      beforeEach: async (context: PersistentE2ETestContext) => {
        console.log('🧹 Preparing for next test...');
        
        // Only do lightweight cleanup, no service restart
        await context.resetBetweenTests();
        
        console.log('✅ Test environment prepared');
      },

      afterEach: async (context: PersistentE2ETestContext) => {
        // Lightweight cleanup only
        try {
          await context.cleanupTestData();
        } catch (error) {
          console.warn('⚠️ Test cleanup warning:', error.message);
        }
      },

      afterAll: async (context: PersistentE2ETestContext) => {
        console.log('🧹 Cleaning up persistent E2E test context...');
        
        // Clean up connections and test data, but leave services running
        await context.lightweightCleanup();
        
        console.log('✅ Persistent E2E test context cleaned up');
      }
    };
  }

  /**
   * Initialize context for persistent harness
   */
  async initialize(options: E2ETestContextOptions = {}) {
    // Use parent initialization but skip service startup
    await super.initialize(options);
  }

  /**
   * Verify that external services are running and healthy
   */
  async verifyServicesRunning(): Promise<void> {
    console.log('🔍 Verifying test services are running...');
    
    const services = [
      { name: 'MailHog', url: 'http://localhost:8025', required: true },
      // { name: 'Workflow Worker', url: 'http://localhost:4001/health', required: true },
      { name: 'Webhook Mock', url: 'http://localhost:8080/__admin/health', required: false }
    ];

    const results = await Promise.allSettled(
      services.map(async service => {
        try {
          const response = await fetch(service.url, { 
            method: 'GET',
            signal: AbortSignal.timeout(5000)
          });
          
          if (response.ok) {
            console.log(`✅ ${service.name} is healthy`);
            return { service: service.name, healthy: true };
          } else {
            throw new Error(`HTTP ${response.status}`);
          }
        } catch (error) {
          const message = `❌ ${service.name} is not available: ${error.message}`;
          if (service.required) {
            throw new Error(message);
          } else {
            console.warn(message);
            return { service: service.name, healthy: false };
          }
        }
      })
    );

    // Check for any rejected promises (required services down)
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length > 0) {
      const failureMessages = failures.map(failure => failure.reason.message).join('\n');
      throw new Error(`Required services are not running:\n${failureMessages}\n\nPlease start the test harness with: npm run test:harness:start`);
    }
  }

  /**
   * Reset state between tests without restarting services
   */
  async resetBetweenTests(): Promise<void> {
    // Clear MailHog messages
    if (this.mailhogClient) {
      await this.mailhogClient.clearMessages();
    }

    // Clear MailHog polling history
    if (this.mailhogPollingService) {
      this.mailhogPollingService.clearProcessedHistory();
    }

    // Clear workflow event stream (if method exists)
    try {
      const { getEventBus } = await import('../../../lib/eventBus');
      const eventBus = getEventBus();
      
      // Check if clearStream method exists before calling it
      if (typeof eventBus.clearStream === 'function') {
        await eventBus.clearStream();
        console.log('🧹 Cleared workflow event stream');
      } else {
        console.log('⚠️ EventBus clearStream method not available, skipping');
      }
    } catch (error) {
      console.warn('⚠️ Could not clear workflow stream:', error.message);
    }

    // Brief pause for any async cleanup
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  /**
   * Clean up test data without affecting services
   */
  async cleanupTestData(): Promise<void> {
    try {
      if (this.emailTestFactory) {
        await this.emailTestFactory.cleanup();
      }
    } catch (error) {
      console.warn('⚠️ Email test factory cleanup warning:', error.message);
    }
  }

  /**
   * Lightweight cleanup that preserves services
   */
  async lightweightCleanup(): Promise<void> {
    // Stop MailHog polling service
    if (this.mailhogPollingService) {
      this.mailhogPollingService.stopPolling();
    }

    // Clean up test data
    await this.cleanupTestData();

    // Close database connections
    if (this.db) {
      await this.db.destroy();
    }

    // Restore environment variables
    this.restoreEnvironmentVariables();

    // Don't stop Docker services - leave them running for next test run
  }

  /**
   * Get quick status of test harness
   */
  async getHarnessStatus(): Promise<{healthy: boolean, services: any[]}> {
    const services = [
      { name: 'MailHog', url: 'http://localhost:8025' },
      { name: 'Workflow Worker', url: 'http://localhost:4001/health' },
      { name: 'Webhook Mock', url: 'http://localhost:8080/__admin/health' }
    ];

    const serviceStatus = await Promise.allSettled(
      services.map(async service => {
        try {
          const response = await fetch(service.url, { 
            signal: AbortSignal.timeout(2000)
          });
          return { ...service, healthy: response.ok, status: response.status };
        } catch (error) {
          return { ...service, healthy: false, error: error.message };
        }
      })
    );

    const results = serviceStatus.map(result => 
      result.status === 'fulfilled' ? result.value : { healthy: false, error: result.reason }
    );

    const allHealthy = results.every(service => service.healthy);

    return {
      healthy: allHealthy,
      services: results
    };
  }
}

/**
 * Helper function to create persistent E2E test helpers
 */
export function createPersistentE2EHelpers() {
  return PersistentE2ETestContext.createPersistentE2EHelpers();
}