import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from './dbConfig';
import { resetDatabase } from './dbReset';
import { createTenant, createCompany, createUser } from './testDataFactory';
import { ICompany } from '../src/interfaces/company.interfaces';
import { IUserWithRoles } from '../src/interfaces/auth.interfaces';

/**
 * Options for initializing test context
 */
export interface TestContextOptions {
  /**
   * Whether to run database seeds during initialization
   * @default true
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
   * Company name for test data
   * @default "Test Company"
   */
  companyName?: string;

  /**
   * User type for test data
   * @default "admin"
   */
  userType?: 'admin' | 'user';
}

/**
 * Manages test context including database connection and test data
 */
export class TestContext {
  public db!: Knex;
  public tenantId!: string;
  public companyId!: string;
  public userId!: string;
  public company!: ICompany;
  public user!: IUserWithRoles;
  private options: TestContextOptions;

  constructor(options: TestContextOptions = {}) {
    this.options = {
      runSeeds: true,
      cleanupTables: [],
      setupCommands: [],
      companyName: 'Test Company',
      userType: 'admin',
      ...options
    };
  }

  /**
   * Initializes the test context
   */
  async initialize(): Promise<void> {
    try {
      // Initialize database connection
      this.db = await createTestDbConnection();

      // Reset database state
      await resetDatabase(this.db, {
        runSeeds: this.options.runSeeds,
        cleanupTables: this.options.cleanupTables,
        preSetupCommands: this.options.setupCommands
      });

      // Create test tenant
      this.tenantId = await createTenant(this.db);

      // Create test company
      this.companyId = await createCompany(this.db, this.tenantId, this.options.companyName);

      // Get company details
      this.company = await this.db('companies')
        .where('company_id', this.companyId)
        .first() as ICompany;

      // Create test user
      this.userId = await createUser(this.db, this.tenantId, {
        name: `Test ${this.options.userType}`,
        user_type: this.options.userType
      });

      // Get user details with roles
      this.user = await this.db('users')
        .select('users.*')
        .leftJoin('user_roles', 'users.user_id', 'user_roles.user_id')
        .leftJoin('roles', 'user_roles.role_id', 'roles.role_id')
        .where('users.user_id', this.userId)
        .first() as IUserWithRoles;

    } catch (error) {
      console.error('Error initializing test context:', error);
      throw error;
    }
  }

  /**
   * Resets the test context to a clean state
   */
  async reset(): Promise<void> {
    try {
      await resetDatabase(this.db, {
        runSeeds: this.options.runSeeds,
        cleanupTables: this.options.cleanupTables,
        preSetupCommands: this.options.setupCommands
      });

      // Re-create test data
      this.tenantId = await createTenant(this.db);
      this.companyId = await createCompany(this.db, this.tenantId, this.options.companyName);
      this.userId = await createUser(this.db, this.tenantId, {
        name: `Test ${this.options.userType}`,
        user_type: this.options.userType
      });

      // Refresh entity references
      this.company = await this.db('companies')
        .where('company_id', this.companyId)
        .first() as ICompany;

      this.user = await this.db('users')
        .select('users.*')
        .leftJoin('user_roles', 'users.user_id', 'user_roles.user_id')
        .leftJoin('roles', 'user_roles.role_id', 'roles.role_id')
        .where('users.user_id', this.userId)
        .first() as IUserWithRoles;
    } catch (error) {
      console.error('Error resetting test context:', error);
      throw error;
    }
  }

  /**
   * Cleans up the test context
   */
  async cleanup(): Promise<void> {
    if (this.db) {
      await this.db.destroy();
    }
  }

  /**
   * Creates a new entity in the current test context
   * @param table Table name
   * @param data Entity data (tenant will be automatically added)
   * @returns Created entity ID
   */
  async createEntity<T extends object>(table: string, data: T): Promise<string> {
    const id = uuidv4();
    await this.db(table).insert({
      ...data,
      tenant: this.tenantId,
      id
    });
    return id;
  }

  /**
   * Retrieves an entity by ID from the current test context
   * @param table Table name
   * @param id Entity ID
   * @returns Entity data or undefined if not found
   */
  async getEntity<T>(table: string, id: string): Promise<T | undefined> {
    return this.db(table)
      .where({ id, tenant: this.tenantId })
      .first();
  }

  /**
   * Creates test context helper functions for use in test files
   */
  static createHelpers() {
    let context: TestContext;

    return {
      /**
       * Initialize test context before all tests
       * @param options Test context options
       */
      beforeAll: async (options: TestContextOptions = {}) => {
        context = new TestContext(options);
        await context.initialize();
        return context;
      },

      /**
       * Reset test context before each test
       */
      beforeEach: async () => {
        await context.reset();
        return context;
      },

      /**
       * Clean up test context after all tests
       */
      afterAll: async () => {
        await context.cleanup();
      }
    };
  }
}