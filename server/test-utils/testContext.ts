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
  userType?: 'client' | 'internal';
}

/**
 * Manages test context including database connection and test data
 */
export class TestContext {
  public static currentTenantId: string;
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
      userType: 'internal',
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
      // this.tenantId = await createTenant(this.db);

      const tenant = await this.db('tenants').first();
      this.tenantId = tenant.tenant;
      TestContext.currentTenantId = this.tenantId;

      // Create test company
      this.companyId = await createCompany(this.db, this.tenantId, this.options.companyName);

      // Get company details with full details
      this.company = await this.db('companies')
        .where({ 
          company_id: this.companyId,
          tenant: this.tenantId 
        })
        .first();

      if (!this.company) {
        throw new Error(`Failed to find company with ID ${this.companyId}`);
      }

      this.company = this.company as ICompany;

      // Create test user
      this.userId = await createUser(this.db, this.tenantId, {
        first_name: `Test ${this.options.userType}`,
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
      const tenant = await this.db('tenants').first();
      this.tenantId = tenant.tenant;
      TestContext.currentTenantId = this.tenantId;
      this.companyId = await createCompany(this.db, this.tenantId, this.options.companyName);
      this.userId = await createUser(this.db, this.tenantId, {
        first_name: `Test ${this.options.userType}`,
        user_type: this.options.userType
      });

      // Refresh entity references
      this.company = await this.db('companies')
        .where({ 
          company_id: this.companyId,
          tenant: this.tenantId 
        })
        .first();

      if (!this.company) {
        throw new Error(`Failed to find company with ID ${this.companyId}`);
      }

      this.company = this.company as ICompany;

      // this.user = await this.db('users')
      //   .select('users.*')
      //   .leftJoin('user_roles', 'users.user_id', 'user_roles.user_id')
      //   .leftJoin('roles', 'user_roles.role_id', 'roles.role_id')
      //   .where('users.user_id', this.userId)
      //   .first() as IUserWithRoles;
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
  async createEntity<T extends object>(
    table: string, 
    data: T, 
    idField: string = 'id'
  ): Promise<string> {
    // Check if data already contains the ID field
    const entityData: Record<string, unknown> = {
      ...data,
      tenant: this.tenantId,
    };
    
    // Remove the 'id' field if it exists and we're using a different idField
    if (idField !== 'id' && 'id' in entityData) {
      delete entityData.id;
    }
    
    // Only generate and add ID if not already present in data
    if (!(idField in data)) {
      entityData[idField] = uuidv4();
    }

    await this.db(table).insert(entityData);
    return entityData[idField] as string;
  }

  /**
   * Retrieves an entity by ID from the current test context
   * @param table Table name
   * @param id Entity ID
   * @param idField Name of the ID column
   * @returns Entity data or undefined if not found
   */
  async getEntity<T>(
    table: string, 
    id: string, 
    idField: string = 'id'
  ): Promise<T | undefined> {
    return this.db(table)
      .where({ [idField]: id, tenant: this.tenantId })
      .first();
  }

  /**
   * Creates test context helper functions for use in test files
   */
  static createHelpers() {
    const testContext = {
      context: undefined as TestContext | undefined,
      
      beforeAll: async (options: TestContextOptions = {}) => {
        testContext.context = new TestContext(options);
        await testContext.context.initialize();
        return testContext.context;
      },

      beforeEach: async () => {
        if (!testContext.context) {
          throw new Error('Test context not initialized. Call beforeAll first.');
        }
        await testContext.context.reset();
        return testContext.context;
      },

      afterAll: async () => {
        if (testContext.context) {
          await testContext.context.cleanup();
          testContext.context = undefined;
        }
      }
    };

    return testContext;
  }
}
