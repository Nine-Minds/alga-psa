/**
 * Extended test context for E2E scenarios
 * Extends the main server TestContext for browser testing scenarios
 */

import { Knex } from 'knex';
import { Browser, Page, BrowserContext, chromium } from '@playwright/test';
import { createTestDbConnection, cleanupTestData, resetDatabase } from '../../lib/testing/db-test-utils';
import { createTestTenant, type TenantTestData } from '../../lib/testing/tenant-test-factory';
import { rollbackTenant } from '../../lib/testing/tenant-creation';

export interface E2ETestContextOptions {
  /**
   * Whether to run database seeds during initialization
   */
  runSeeds?: boolean;

  /**
   * Tables to clean up during reset
   */
  cleanupTables?: string[];

  /**
   * Custom SQL commands to run during initialization
   */
  setupCommands?: string[];

  /**
   * Browser options for Playwright
   */
  browserOptions?: {
    headless?: boolean;
    slowMo?: number;
    devtools?: boolean;
  };

  /**
   * Whether to reuse browser instance
   */
  reuseBrowser?: boolean;

  /**
   * Base URL for the application
   */
  baseUrl?: string;
}

/**
 * Extended test context for E2E integration tests
 */
export class E2ETestContext {
  public db!: Knex;
  public browser!: Browser;
  public context!: BrowserContext;
  public page!: Page;
  public tenantData!: TenantTestData;
  public baseUrl: string;
  
  private options: E2ETestContextOptions;
  private cleanupTasks: Array<() => Promise<void>> = [];

  constructor(options: E2ETestContextOptions = {}) {
    this.options = {
      runSeeds: true,
      cleanupTables: [],
      setupCommands: [],
      browserOptions: {
        headless: !process.env.DEBUG_BROWSER,
        slowMo: process.env.DEBUG_BROWSER ? 100 : 0,
      },
      reuseBrowser: false,
      baseUrl: process.env.EE_BASE_URL || 'http://localhost:3001',
      ...options
    };
    this.baseUrl = this.options.baseUrl!;
  }

  /**
   * Initialize the E2E test context
   */
  async initialize(): Promise<void> {
    try {
      // Initialize database connection
      this.db = createTestDbConnection();
      
      // Reset database state (disable seeds for now)
      await resetDatabase(this.db, {
        runSeeds: false, // Disable seeds to avoid path issues
        cleanupTables: this.options.cleanupTables,
        preSetupCommands: this.options.setupCommands
      });

      // Create test tenant with admin user
      this.tenantData = await createTestTenant(this.db);
      
      // Add tenant cleanup task
      this.cleanupTasks.push(async () => {
        await rollbackTenant(this.db, this.tenantData.tenant.tenantId);
      });

      // Initialize browser
      await this.initializeBrowser();

    } catch (error) {
      console.error('Error initializing E2E test context:', error);
      throw error;
    }
  }

  /**
   * Initialize browser and page
   */
  private async initializeBrowser(): Promise<void> {
    // Launch browser
    this.browser = await chromium.launch(this.options.browserOptions);
    
    // Create browser context
    this.context = await this.browser.newContext({
      baseURL: this.baseUrl,
      viewport: { width: 1920, height: 1080 },
      // Add any additional context options
    });

    // Create page
    this.page = await this.context.newPage();
    
    // Add browser cleanup task
    this.cleanupTasks.push(async () => {
      await this.page.close();
      await this.context.close();
      await this.browser.close();
    });
  }

  /**
   * Reset the test context to a clean state
   */
  async reset(): Promise<void> {
    try {
      // Reset database
      await resetDatabase(this.db, {
        runSeeds: this.options.runSeeds,
        cleanupTables: this.options.cleanupTables,
        preSetupCommands: this.options.setupCommands
      });

      // Create new test tenant
      this.tenantData = await createTestTenant(this.db);

      // Reset browser state
      await this.page.goto('about:blank');
      await this.context.clearCookies();
      await this.context.clearPermissions();

    } catch (error) {
      console.error('Error resetting E2E test context:', error);
      throw error;
    }
  }

  /**
   * Create a new page in the current context
   */
  async newPage(): Promise<Page> {
    return await this.context.newPage();
  }

  /**
   * Navigate to a specific URL
   */
  async goto(path: string): Promise<void> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    await this.page.goto(url);
  }

  /**
   * Create additional test tenant for multi-tenant testing
   */
  async createAdditionalTenant(): Promise<TenantTestData> {
    const additionalTenant = await createTestTenant(this.db);
    
    // Add cleanup task for this tenant
    this.cleanupTasks.push(async () => {
      await rollbackTenant(this.db, additionalTenant.tenant.tenantId);
    });

    return additionalTenant;
  }

  /**
   * Wait for application to be ready
   */
  async waitForAppReady(): Promise<void> {
    try {
      await this.page.goto(`${this.baseUrl}/health`);
      await this.page.waitForResponse(response => 
        response.url().includes('/health') && response.status() === 200
      );
    } catch (error) {
      // If health check fails, just wait a bit
      await this.page.waitForTimeout(2000);
    }
  }

  /**
   * Take screenshot for debugging
   */
  async screenshot(name: string): Promise<void> {
    await this.page.screenshot({
      path: `screenshots/${name}-${Date.now()}.png`,
      fullPage: true
    });
  }

  /**
   * Get browser console logs
   */
  async getConsoleLogs(): Promise<string[]> {
    return await this.page.evaluate(() => {
      // @ts-ignore - accessing console logs
      return window.console.logs || [];
    });
  }

  /**
   * Clean up the test context
   */
  async cleanup(): Promise<void> {
    // Run all cleanup tasks in reverse order
    for (const cleanupTask of this.cleanupTasks.reverse()) {
      try {
        await cleanupTask();
      } catch (error) {
        console.error('Error during cleanup:', error);
      }
    }

    // Close database connection
    if (this.db) {
      await this.db.destroy();
    }

    // Clear cleanup tasks
    this.cleanupTasks = [];
  }

  /**
   * Create test context helper functions for E2E tests
   */
  static createHelpers() {
    const testContext = {
      context: undefined as E2ETestContext | undefined,
      
      beforeAll: async (options: E2ETestContextOptions = {}) => {
        testContext.context = new E2ETestContext(options);
        await testContext.context.initialize();
        await testContext.context.waitForAppReady();
        return testContext.context;
      },

      beforeEach: async () => {
        if (!testContext.context) {
          throw new Error('E2E test context not initialized. Call beforeAll first.');
        }
        await testContext.context.reset();
        return testContext.context;
      },

      afterAll: async () => {
        if (testContext.context) {
          await testContext.context.cleanup();
          testContext.context = undefined;
        }
      },

      afterEach: async () => {
        if (testContext.context && process.env.DEBUG_BROWSER) {
          // Take screenshot on test completion in debug mode
          await testContext.context.screenshot('test-completed');
        }
      }
    };

    return testContext;
  }
}

/**
 * Utility function to create isolated E2E test context
 */
export async function createIsolatedE2EContext(
  options: E2ETestContextOptions = {}
): Promise<E2ETestContext> {
  const context = new E2ETestContext(options);
  await context.initialize();
  return context;
}

/**
 * Utility function for parallel E2E testing
 */
export async function createMultipleE2EContexts(
  count: number,
  options: E2ETestContextOptions = {}
): Promise<E2ETestContext[]> {
  const contexts: E2ETestContext[] = [];
  
  for (let i = 0; i < count; i++) {
    const context = await createIsolatedE2EContext({
      ...options,
      // Ensure each context has unique browser if not reusing
      reuseBrowser: false,
    });
    contexts.push(context);
  }

  return contexts;
}