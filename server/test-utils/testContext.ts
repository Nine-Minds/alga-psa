import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from './dbConfig';
import { resetDatabase } from './dbReset';
import { createTenant, createClient, createUser } from './testDataFactory';
import { IClient } from 'server/src/interfaces/client.interfaces';
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
   * Client name for test data
   * @default "Test Client"
   */
  clientName?: string;

  /**
   * User type for test data
   * @default "admin"
   */
  userType?: 'client' | 'internal';

  /**
   * Whether to run a full database reset between tests
   * @default true
   */
  resetBetweenTests?: boolean;
}

/**
 * Manages test context including database connection and test data
 */
export class TestContext {
  public static currentTenantId: string;
  private rootDb!: Knex;
  private activeTransaction: Knex.Transaction | null = null;
  private baseTenantId?: string;
  private tenantKnexMockApplied = false;
  public tenantId!: string;
  public clientId!: string;
  public userId!: string;
  public client!: IClient;
  public user!: IUserWithRoles;
  private options: TestContextOptions;

  public get db(): Knex {
    if (this.activeTransaction) {
      return this.activeTransaction;
    }

    if (!this.rootDb) {
      throw new Error('Test database connection not initialized');
    }

    return this.rootDb;
  }

  private async bindTenantKnexToTransaction(): Promise<void> {
    if (this.tenantKnexMockApplied) {
      return;
    }

    try {
      const { vi } = await import('vitest');
      const dbModule = await import('server/src/lib/db');
      const tenantModule = await import('server/src/lib/tenant');

      if (!vi?.spyOn) {
        return;
      }

      vi.spyOn(dbModule, 'createTenantKnex').mockImplementation(async () => ({
        knex: this.db,
        tenant: this.tenantId
      }));

      if (typeof dbModule.getCurrentTenantId === 'function') {
        vi.spyOn(dbModule, 'getCurrentTenantId').mockImplementation(async () => this.tenantId ?? null);
      }

      if (typeof dbModule.runWithTenant === 'function') {
        vi.spyOn(dbModule, 'runWithTenant').mockImplementation(async (_tenant, fn) => fn());
      }

      if (tenantModule?.getTenantForCurrentRequest) {
        vi.spyOn(tenantModule, 'getTenantForCurrentRequest').mockImplementation(async () => this.tenantId ?? null);
      }

      if (tenantModule?.getTenantFromHeaders) {
        vi.spyOn(tenantModule, 'getTenantFromHeaders').mockImplementation(() => this.tenantId ?? null);
      }

      this.tenantKnexMockApplied = true;
    } catch (error) {
      // If vitest or the db module aren't available (e.g. non-test environments), skip mocking
      if (process.env.NODE_ENV === 'test') {
        console.warn('Failed to bind tenant Knex to transaction:', error);
      }
    }
  }

  public get transaction(): Knex.Transaction | null {
    return this.activeTransaction;
  }

  constructor(options: TestContextOptions = {}) {
    this.options = {
      runSeeds: true,
      cleanupTables: [],
      setupCommands: [],
      clientName: 'Test Client',
      userType: 'internal',
      resetBetweenTests: true,
      ...options
    };
  }

  /**
   * Initializes the test context
   */
  async initialize(): Promise<void> {
    try {
      const setupDb = await createTestDbConnection();

      await resetDatabase(setupDb, {
        runSeeds: this.options.runSeeds,
        cleanupTables: this.options.cleanupTables,
        preSetupCommands: this.options.setupCommands
      });

      await setupDb.destroy();

      this.rootDb = await createTestDbConnection();

      await this.ensureTenantInitialized();
      await this.beginTestTransaction();
      await this.prepareTransactionalState();
    } catch (error) {
      console.error('Error initializing test context:', error);
      throw error;
    }
  }

  private async ensureTenantInitialized(): Promise<void> {
    if (!this.rootDb) {
      throw new Error('Test database connection not initialized');
    }

    const tenantRecord = await this.rootDb('tenants').first();

    if (tenantRecord?.tenant) {
      this.baseTenantId = tenantRecord.tenant as string;
    } else {
      this.baseTenantId = await createTenant(this.rootDb);
    }

    this.tenantId = this.baseTenantId;
    TestContext.currentTenantId = this.tenantId;
  }

  private async beginTestTransaction(): Promise<void> {
    if (!this.rootDb) {
      throw new Error('Test database connection not initialized');
    }

    this.activeTransaction = await this.rootDb.transaction();
  }

  private async prepareTransactionalState(): Promise<void> {
    if (!this.baseTenantId) {
      await this.ensureTenantInitialized();
    }

    this.tenantId = this.baseTenantId as string;
    TestContext.currentTenantId = this.tenantId;

    if (this.options.cleanupTables?.length) {
      await this.truncateCleanupTables(this.db, this.options.cleanupTables);
    }

    if (this.options.setupCommands?.length) {
      for (const command of this.options.setupCommands) {
        await this.db.raw(command);
      }
    }

    await this.ensureBaseEntities();
    await this.bindTenantKnexToTransaction();
  }

  private async truncateCleanupTables(db: Knex, tables: string[]): Promise<void> {
    const uniqueTables = Array.from(new Set(tables)).filter(Boolean);

    if (!uniqueTables.length) {
      return;
    }

    // Look up tables that actually exist to avoid errors when migrations drop old tables.
    const existingTableRows = await db
      .withSchema('pg_catalog')
      .select('tablename')
      .from('pg_tables')
      .where('schemaname', 'public')
      .whereIn('tablename', uniqueTables);

    const existingTables = new Set(existingTableRows.map(row => row.tablename));
    const tablesToTruncate = uniqueTables.filter(table => existingTables.has(table));

    if (!tablesToTruncate.length) {
      return;
    }

    const quotedTables = tablesToTruncate
      .map(table => table.replace(/"/g, '""'))
      .map(table => `"${table}"`)
      .join(', ');

    await db.raw(`TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE`);
  }

  private async rollbackActiveTransaction(): Promise<void> {
    if (!this.activeTransaction) {
      return;
    }

    const trx = this.activeTransaction;
    this.activeTransaction = null;

    await trx.rollback().catch(error => {
      const message = error instanceof Error ? error.message : String(error);

      if (
        message.includes('Transaction rejected with non-error') ||
        message.includes('Transaction query already complete')
      ) {
        return;
      }

      console.error('Error rolling back test transaction:', error);
      throw error;
    });
  }

  /**
   * Resets the test context to a clean state
   */
  async reset(): Promise<void> {
    try {
      await this.rollbackActiveTransaction();
      await this.beginTestTransaction();
      await this.prepareTransactionalState();
    } catch (error) {
      console.error('Error resetting test context:', error);
      throw error;
    }
  }

  async finishTestTransaction(): Promise<void> {
    await this.rollbackActiveTransaction();
  }

  private async ensureBaseEntities(): Promise<void> {
    if (!this.tenantId) {
      const tenant = await this.db('tenants').first();
      this.tenantId = tenant?.tenant;
      TestContext.currentTenantId = this.tenantId;
    }

    if (!this.tenantId) {
      throw new Error('Tenant not initialized in ensureBaseEntities');
    }

    let clientRecord = this.clientId
      ? await this.db('clients')
          .where({ client_id: this.clientId, tenant: this.tenantId })
          .first()
      : null;

    if (!clientRecord) {
      this.clientId = await createClient(this.db, this.tenantId, this.options.clientName);
      clientRecord = await this.db('clients')
        .where({ client_id: this.clientId, tenant: this.tenantId })
        .first();
    }

    if (!clientRecord) {
      throw new Error('Failed to ensure client record');
    }

    this.client = clientRecord as IClient;

    let userRecord = this.userId
      ? await this.db('users')
          .where({ user_id: this.userId, tenant: this.tenantId })
          .first()
      : null;

    if (!userRecord) {
      this.userId = await createUser(this.db, this.tenantId, {
        first_name: `Test ${this.options.userType}`,
        user_type: this.options.userType
      });

      userRecord = await this.db('users')
        .where({ user_id: this.userId, tenant: this.tenantId })
        .first();
    }

    this.user = await this.db('users')
      .select('users.*')
      .leftJoin('user_roles', 'users.user_id', 'user_roles.user_id')
      .leftJoin('roles', 'user_roles.role_id', 'roles.role_id')
      .where('users.user_id', this.userId)
      .first() as IUserWithRoles;
  }

  /**
   * Rolls back any pending transactions
   * This is called after each test to ensure a clean state
   */
  async rollback(): Promise<void> {
    // No-op for now as we use reset() for cleanup
    // This method exists to maintain compatibility with test helpers
  }

  /**
   * Cleans up the test context
   */
  async cleanup(): Promise<void> {
    await this.rollbackActiveTransaction();

    if (this.rootDb) {
      await this.rootDb.destroy();
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

      afterEach: async () => {
        if (!testContext.context) {
          return;
        }
        await testContext.context.finishTestTransaction();
      },

      afterAll: async () => {
        if (testContext.context) {
          await testContext.context.cleanup();
          testContext.context = undefined;
        }
      }
    };

    void import('vitest')
      .then(({ afterEach }) => {
        afterEach(async () => {
          if (testContext.context) {
            await testContext.context.finishTestTransaction();
          }
        });
      })
      .catch(() => undefined);

    return testContext;
  }
}
