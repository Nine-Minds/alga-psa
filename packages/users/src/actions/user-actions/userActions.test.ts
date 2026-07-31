import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const getAdminConnectionMock = vi.hoisted(() => vi.fn());
const withTransactionMock = vi.hoisted(() => vi.fn());
const hasPermissionMock = vi.hoisted(() => vi.fn());
const hashPasswordMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());
const upsertMock = vi.hoisted(() => vi.fn());
const userUpdateMock = vi.hoisted(() => vi.fn());
const getUserWithRolesMock = vi.hoisted(() => vi.fn());
const isInReportsToChainMock = vi.hoisted(() => vi.fn());
const isEnterpriseRef = vi.hoisted(() => ({ value: false }));
const deleteEntityWithValidationMock = vi.hoisted(() => vi.fn());
const publishWorkflowEventMock = vi.hoisted(() => vi.fn());
const modelGetUserRolesMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/core', () => ({
  get isEnterprise() {
    return isEnterpriseRef.value;
  },
}));

// deleteEntityWithValidation is imported from @alga-psa/core/server, not the
// package root — mock that subpath so the stub (not the real impl) is used.
vi.mock('@alga-psa/core/server', () => ({
  deleteEntityWithValidation: deleteEntityWithValidationMock,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...args: any[]) => any) => {
    return (...args: any[]) => {
      if (args.length === 1) {
        return fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, args[0]);
      }
      return fn(...args);
    };
  },
  withOptionalAuth: (fn: (...args: any[]) => any) => fn,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  withTransaction: withTransactionMock,
  withAdminTransaction: vi.fn(),
  // The fakes in this file are full query builders whose own `.where(...)`
  // supplies the filtering, so the tenant facade just passes the table through.
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
    unscoped: (t: string, _reason?: string) => conn(t),
  }),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: getAdminConnectionMock,
}));

vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    update: userUpdateMock,
    getUserWithRoles: getUserWithRolesMock,
    getUserRoles: modelGetUserRolesMock,
    isInReportsToChain: isInReportsToChainMock,
  },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: publishWorkflowEventMock,
}));

vi.mock('@alga-psa/core/encryption', () => ({
  hashPassword: hashPasswordMock,
}));

vi.mock('@alga-psa/user-composition/lib/permissions', () => ({
  hasPermission: hasPermissionMock,
  throwPermissionError: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock('@alga-psa/db/models/userPreferences', () => ({
  default: {
    upsert: upsertMock,
  },
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function createAdminDb(existingUserId?: string) {
  return ((table: string) => {
    if (table !== 'users') {
      throw new Error(`Unexpected admin table ${table}`);
    }

    return {
      where: (_criteria: Record<string, any>) => ({
        whereNot: (_column: string, _value: string) => ({
          first: async () => (existingUserId ? { user_id: existingUserId } : null),
        }),
        first: async () => (existingUserId ? { user_id: existingUserId } : null),
      }),
    };
  }) as any;
}

// Mirrors the production admin lookup: returns a hit only when the criteria's
// user_type matches one of the rows configured here. Used to prove the global
// email check is correctly scoped per user_type.
function createAdminDbByType(rowsByUserType: { internal?: string; client?: string; any?: string }) {
  return ((table: string) => {
    if (table !== 'users') {
      throw new Error(`Unexpected admin table ${table}`);
    }

    return {
      where: (criteria: Record<string, any>) => {
        const wantedType = criteria?.user_type as 'internal' | 'client' | undefined;
        const hit = wantedType ? rowsByUserType[wantedType] : rowsByUserType.any;
        return {
          whereNot: (_column: string, _value: string) => ({
            first: async () => (hit ? { user_id: hit } : null),
          }),
          first: async () => (hit ? { user_id: hit } : null),
        };
      },
    };
  }) as any;
}

function createTenantDb(input: { plan: 'solo' | 'pro'; licensedUserCount: number | null; usedInternalUsers: number }) {
  // Captures the row inserted by addUser so the post-insert
  // getSafeUserWithRoles lookup (where().select(FIELDS).first()) can return it.
  let insertedUser: Record<string, any> | null = null;

  return ((table: string) => {
    if (table === 'roles') {
      return {
        where: (_criteria: Record<string, any>) => ({
          first: async () => ({ role_id: 'role-1', client: false, msp: true }),
        }),
      };
    }

    if (table === 'tenants') {
      const tenantRow = {
        licensed_user_count: input.licensedUserCount,
        plan: input.plan,
      };
      // The tenant facade scopes by tenant, so addUser now reads the row via
      // tenantDb.table('tenants').first(...) without an explicit `.where`.
      return {
        first: async (..._fields: any[]) => tenantRow,
        where: (_criteria: Record<string, any>) => ({
          first: async () => tenantRow,
        }),
      };
    }

    if (table === 'users') {
      return {
        where: (_criteria: Record<string, any>) => ({
          count: async () => [{ count: String(input.usedInternalUsers) }],
          select: (..._fields: any[]) => ({
            first: async () => insertedUser,
          }),
        }),
        insert: (values: Record<string, any>) => ({
          returning: async () => {
            insertedUser = { user_id: 'new-user', ...values };
            return [insertedUser];
          },
        }),
      };
    }

    if (table === 'user_roles') {
      return {
        insert: async (_values: Record<string, any>) => [],
      };
    }

    throw new Error(`Unexpected tenant table ${table}`);
  }) as any;
}

// Tenant DB stub for updateUser. The action now reads the user's current
// email/user_type straight from trx('users').select('email','user_type') and,
// after the update, re-reads the row via select(USER_RESPONSE_FIELD_NAMES)
// (an array arg) inside getSafeUserWithRoles — the arg shape disambiguates.
function createUpdateTenantDb(current: { email: string; user_type?: 'internal' | 'client' }) {
  const updatedRow = { user_id: 'user-1', email: 'updated@example.com' };

  return ((table: string) => {
    if (table === 'users') {
      return {
        where: (_criteria: Record<string, any>) => ({
          select: (...fields: any[]) => ({
            first: async () =>
              Array.isArray(fields[0])
                ? updatedRow
                : { email: current.email, user_type: current.user_type ?? 'internal' },
          }),
        }),
      };
    }

    if (table === 'boards') {
      return {
        where: (_criteria: Record<string, any>) => ({
          update: async (_values: Record<string, any>) => 0,
        }),
      };
    }

    throw new Error(`Unexpected tenant table ${table}`);
  }) as any;
}

describe('addUser', () => {
  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset();
    getAdminConnectionMock.mockReset();
    withTransactionMock.mockReset();
    hasPermissionMock.mockReset();
    hashPasswordMock.mockReset();
    revalidatePathMock.mockReset();
    upsertMock.mockReset();
    userUpdateMock.mockReset();
    getUserWithRolesMock.mockReset();
    isInReportsToChainMock.mockReset();
    publishWorkflowEventMock.mockReset();
    modelGetUserRolesMock.mockReset();

    publishWorkflowEventMock.mockResolvedValue(undefined);
    modelGetUserRolesMock.mockResolvedValue([]);
    hasPermissionMock.mockResolvedValue(true);
    hashPasswordMock.mockResolvedValue('hashed-password');
    upsertMock.mockResolvedValue(undefined);
    revalidatePathMock.mockReturnValue(undefined);
    userUpdateMock.mockResolvedValue(undefined);
    getUserWithRolesMock.mockResolvedValue({
      user_id: 'user-1',
      email: 'updated@example.com',
    });
    isInReportsToChainMock.mockResolvedValue(false);

    withTransactionMock.mockImplementation(async (db: any, callback: (trx: any) => Promise<any>) => callback(db));
    getAdminConnectionMock.mockResolvedValue(createAdminDb());
  });

  async function loadAddUser() {
    const mod = await import('./userActions');
    return mod.addUser as any;
  }

  async function loadUpdateUser() {
    const mod = await import('./userActions');
    return mod.updateUser as any;
  }

  const actingUser = { user_id: 'user-1', user_type: 'internal' } as any;
  const tenantContext = { tenant: 'tenant-1' };
  const userData = {
    firstName: 'Solo',
    lastName: 'User',
    email: 'solo@example.com',
    password: 'password123',
    roleId: 'role-1',
    userType: 'internal' as const,
  };

  it('rejects adding a second internal user on the Solo plan', async () => {
    createTenantKnexMock.mockResolvedValue({
      knex: createTenantDb({ plan: 'solo', licensedUserCount: 1, usedInternalUsers: 1 }),
    });

    const addUser = await loadAddUser();
    const result = await addUser(actingUser, tenantContext, userData);

    expect(result).toEqual({
      success: false,
      code: 'SOLO_PLAN_LIMIT',
      error: 'Solo plan is limited to 1 user. Upgrade to Pro to add more users.',
    });
  });

  it('allows adding the first internal user on the Solo plan', async () => {
    createTenantKnexMock.mockResolvedValue({
      knex: createTenantDb({ plan: 'solo', licensedUserCount: 1, usedInternalUsers: 0 }),
    });

    const addUser = await loadAddUser();
    const result = await addUser(actingUser, tenantContext, userData);

    expect(result).toMatchObject({
      success: true,
      user: {
        email: 'solo@example.com',
        user_type: 'internal',
      },
    });
  });

  it('does not apply the Solo restriction to Pro tenants', async () => {
    createTenantKnexMock.mockResolvedValue({
      knex: createTenantDb({ plan: 'pro', licensedUserCount: 5, usedInternalUsers: 1 }),
    });

    const addUser = await loadAddUser();
    const result = await addUser(actingUser, tenantContext, userData);

    expect(result).toMatchObject({
      success: true,
      user: {
        email: 'solo@example.com',
      },
    });
  });

  it('rejects updating an email when another tenant already uses it', async () => {
    createTenantKnexMock.mockResolvedValue({
      knex: createUpdateTenantDb({ email: 'updated@example.com', user_type: 'internal' }),
    });
    getAdminConnectionMock.mockResolvedValue(createAdminDb('other-tenant-user'));

    const updateUser = await loadUpdateUser();

    const result = await updateUser(actingUser, tenantContext, actingUser.user_id, {
      email: 'duplicate@example.com',
    });

    expect(result).toEqual({
      success: false,
      code: 'EMAIL_ALREADY_EXISTS',
      error: 'A user with this email address already exists',
    });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('normalizes updated email addresses to lowercase before saving', async () => {
    createTenantKnexMock.mockResolvedValue({
      knex: createUpdateTenantDb({ email: 'old@example.com', user_type: 'internal' }),
    });

    const updateUser = await loadUpdateUser();
    const result = await updateUser(actingUser, tenantContext, actingUser.user_id, {
      email: 'Updated@Example.com',
      first_name: 'Updated',
    });

    expect(userUpdateMock).toHaveBeenCalledWith(
      expect.anything(),
      actingUser.user_id,
      expect.objectContaining({
        email: 'updated@example.com',
        first_name: 'Updated',
      })
    );
    expect(result).toMatchObject({
      success: true,
      user: {
        user_id: 'user-1',
        email: 'updated@example.com',
      },
    });
  });

  // Regression for PR #2356: editing reports_to (or any field) re-submits the
  // user's existing email and used to trip EMAIL_ALREADY_EXISTS on legitimate
  // cross-tenant duplicates. The global lookup must be skipped when the email
  // hasn't changed.
  it('skips the global email check when the submitted email matches the current one', async () => {
    createTenantKnexMock.mockResolvedValue({
      knex: createUpdateTenantDb({ email: 'updated@example.com', user_type: 'internal' }),
    });
    // Admin DB would *return* a duplicate if asked — this test passes only if
    // the global check is never consulted.
    getAdminConnectionMock.mockResolvedValue(createAdminDb('cross-tenant-duplicate'));

    const updateUser = await loadUpdateUser();
    const result = await updateUser(actingUser, tenantContext, actingUser.user_id, {
      email: 'Updated@Example.com', // same as existing 'updated@example.com' modulo case
      reports_to: 'manager-user',
    });

    expect(getAdminConnectionMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true });
    expect(userUpdateMock).toHaveBeenCalledWith(
      expect.anything(),
      actingUser.user_id,
      expect.objectContaining({
        email: 'updated@example.com',
        reports_to: 'manager-user',
      })
    );
  });

  // Regression for PR #2356: tenant provisioning creates the same person as an
  // `internal` user in their MSP tenant and a `client` user in the master
  // tenant. Updating the internal user's email must not be blocked by the
  // unrelated client-portal row.
  it('allows updating email when only a different user_type uses it globally', async () => {
    // Existing user is internal with a different email — forces the change
    // path AND establishes the user_type to scope by.
    createTenantKnexMock.mockResolvedValue({
      knex: createUpdateTenantDb({ email: 'old@example.com', user_type: 'internal' }),
    });
    // A client-portal duplicate exists, but no internal duplicate.
    getAdminConnectionMock.mockResolvedValue(
      createAdminDbByType({ client: 'client-portal-row' })
    );

    const updateUser = await loadUpdateUser();
    const result = await updateUser(actingUser, tenantContext, actingUser.user_id, {
      email: 'new@example.com',
    });

    expect(result).toMatchObject({ success: true });
    expect(userUpdateMock).toHaveBeenCalled();
  });
});

// CE-side tables present in the deleteUser cleanup lists.
// Verified against a live dev DB on 2026-05-08; updates to the cleanup list
// in userActions.ts must keep this set in sync.
const CE_CLEANUP_TABLES: ReadonlySet<string> = new Set([
  // null lists
  'boards', 'workflow_tasks', 'comments', 'client_contracts',
  'contract_pricing_schedules', 'contract_template_pricing_schedules',
  'escalation_managers', 'external_files', 'external_tax_imports',
  'invoice_template_assignments', 'project_tasks', 'projects',
  'quote_activities', 'quote_document_template_assignments', 'quote_items',
  'quotes', 'service_categories', 'sla_audit_log', 'statuses', 'tag_mappings',
  'task_resources', 'ticket_resources', 'time_entries', 'time_sheets',
  'authorization_bundles', 'authorization_bundle_revisions',
  'authorization_bundle_assignments', 'authorization_bundle_rules',
  // reassign lists
  'asset_associations', 'asset_document_associations', 'asset_history',
  'asset_maintenance_history', 'asset_maintenance_schedules',
  'asset_service_history', 'asset_ticket_associations', 'categories',
  'document_content', 'documents', 'impacts', 'priorities', 'severities',
  'urgencies', 'project_templates', 'tenant_telemetry_settings',
  // delete lists
  'sessions', 'password_reset_tokens', 'user_notification_preferences',
  'user_internal_notification_preferences', 'internal_notifications',
  'notification_logs', 'mobile_push_tokens', 'portal_domain_session_otts',
  'telemetry_consent_log', 'calendar_providers', 'team_members',
  'schedule_entry_assignees', 'comment_reactions', 'project_task_comment_reactions',
  'project_task_comments', 'project_template_task_resources', 'time_sheet_comments',
  'user_roles', 'user_preferences', 'import_jobs', 'user_invitations',
  'user_activity_group_items', 'user_activity_groups',
  // Always present in both editions:
  'users', 'clients',
]);

const EE_ONLY_TABLES: ReadonlyArray<string> = [
  'platform_notification_recipients',
  'user_auth_accounts',
  'chats',
];

// Tables previously dropped by migrations. If deleteUser ever references
// them again it'll FK-violate against a non-existent relation in production.
const REMOVED_TABLES: ReadonlyArray<string> = [
  'file_references',           // dropped 20241101210327
  'company_email_settings',    // dropped 20250811143629
];

interface RecordedOp {
  table: string;
  op: 'update' | 'del' | 'first';
  values?: Record<string, unknown>;
}

function makeFakeTrx(present: ReadonlySet<string>) {
  const ops: RecordedOp[] = [];

  function builder(table: string) {
    if (!present.has(table)) {
      throw new Error(`relation "${table}" does not exist`);
    }

    const chain = {
      where: (_criteria: Record<string, unknown>) => chain,
      whereIn: (_column: string, _sub: unknown) => chain,
      whereNull: (_column: string) => chain,
      whereRaw: (_sql: string, _bindings?: unknown) => chain,
      orWhere: (_criteria: Record<string, unknown>) => chain,
      // Eager subquery builder (e.g. user_activity_groups.select('group_id'))
      // used inside whereIn after the tenant-scope migration.
      select: (..._cols: unknown[]) => chain,
      update: async (values: Record<string, unknown>) => {
        ops.push({ table, op: 'update', values });
        return 0;
      },
      del: async () => {
        ops.push({ table, op: 'del' });
        // Mock the final users-row delete returning a positive count so
        // deleteUser doesn't think the row was missing.
        return table === 'users' ? 1 : 0;
      },
      delete: async () => {
        ops.push({ table, op: 'del' });
        return table === 'users' ? 1 : 0;
      },
      first: async () => {
        ops.push({ table, op: 'first' });
        // assignedClient lookup returns null (no FK to clients)
        return null;
      },
    };
    return chain;
  }

  const trx: any = builder;
  trx.schema = {
    hasTable: async (name: string) => present.has(name),
  };
  trx.fn = { now: () => '2026-05-08T00:00:00.000Z' };

  return { trx, ops };
}

describe('deleteUser', () => {
  // Matches the withAuth mock at the top of the file.
  const ACTOR_USER_ID = 'user-1';
  const TARGET_USER_ID = 'target-user';

  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset();
    withTransactionMock.mockReset();
    hasPermissionMock.mockReset();
    revalidatePathMock.mockReset();
    deleteEntityWithValidationMock.mockReset();

    hasPermissionMock.mockResolvedValue(true);
    revalidatePathMock.mockReturnValue(undefined);

    isEnterpriseRef.value = false;
  });

  async function loadDeleteUser() {
    const mod = await import('./userActions');
    return mod.deleteUser as (userId: string) => Promise<any>;
  }

  /**
   * Drives deleteUser end-to-end against a fake trx that throws
   * "relation does not exist" for any table not in `present`. Returns the
   * recorded operation log so each test can assert on the touched tables.
   */
  async function runDeleteUser(present: ReadonlySet<string>) {
    const { trx, ops } = makeFakeTrx(present);

    createTenantKnexMock.mockResolvedValue({ knex: trx });
    withTransactionMock.mockImplementation(
      async (_db: unknown, cb: (t: unknown) => Promise<unknown>) => cb(trx)
    );
    deleteEntityWithValidationMock.mockImplementation(
      async (
        _entity: string,
        _id: string,
        _knex: unknown,
        tenant: string,
        performDelete: (t: unknown, tenantId: string) => Promise<void>
      ) => {
        await performDelete(trx, tenant);
        return { canDelete: true, dependencies: [], alternatives: [], deleted: true };
      }
    );

    const deleteUser = await loadDeleteUser();
    const result = await deleteUser(TARGET_USER_ID);
    return { result, ops };
  }

  it('CE: cleans up every CE table without referencing dropped tables', async () => {
    isEnterpriseRef.value = false;

    // CE schema: every CE cleanup table present, EE tables absent.
    const ceSchema = new Set(CE_CLEANUP_TABLES);
    const { result, ops } = await runDeleteUser(ceSchema);

    expect(result).toMatchObject({ success: true, deleted: true });

    const touched = new Set(ops.map((o) => o.table));
    // Every CE cleanup table should appear at least once in the op log.
    for (const table of CE_CLEANUP_TABLES) {
      expect(touched, `expected to touch ${table} on CE`).toContain(table);
    }
    // EE-only tables must not be touched at all on CE.
    for (const table of EE_ONLY_TABLES) {
      expect(touched, `${table} is EE-only and should be skipped on CE`).not.toContain(table);
    }
    // Regression: dropped tables must not be referenced.
    for (const table of REMOVED_TABLES) {
      expect(touched, `${table} was dropped and must not be referenced`).not.toContain(table);
    }
  });

  it('EE: also cleans EE-only tables when present', async () => {
    isEnterpriseRef.value = true;

    const eeSchema = new Set([...CE_CLEANUP_TABLES, ...EE_ONLY_TABLES]);
    const { result, ops } = await runDeleteUser(eeSchema);

    expect(result).toMatchObject({ success: true, deleted: true });

    const touched = new Set(ops.map((o) => o.table));
    for (const table of EE_ONLY_TABLES) {
      expect(touched, `expected to touch EE-only ${table} on EE`).toContain(table);
    }
    for (const table of REMOVED_TABLES) {
      expect(touched).not.toContain(table);
    }
  });

  it('EE with EE-only tables absent: hasTable guard prevents the call', async () => {
    isEnterpriseRef.value = true;

    // EE flag on, but the EE-specific tables aren't in the schema (older
    // tenant or partial migration state). The hasTable guard inside
    // deleteUser must skip those operations rather than throw.
    const ceSchema = new Set(CE_CLEANUP_TABLES);
    const { result, ops } = await runDeleteUser(ceSchema);

    expect(result).toMatchObject({ success: true, deleted: true });

    const touched = new Set(ops.map((o) => o.table));
    for (const table of EE_ONLY_TABLES) {
      expect(touched, `${table} missing → guard should skip it`).not.toContain(table);
    }
  });

  it('refuses self-deletion before any cleanup runs', async () => {
    const { trx } = makeFakeTrx(new Set(CE_CLEANUP_TABLES));
    createTenantKnexMock.mockResolvedValue({ knex: trx });
    withTransactionMock.mockImplementation(
      async (_db: unknown, cb: (t: unknown) => Promise<unknown>) => cb(trx)
    );

    const deleteUser = await loadDeleteUser();
    const result = await deleteUser(ACTOR_USER_ID);

    expect(result).toMatchObject({
      success: false,
      canDelete: false,
      code: 'VALIDATION_FAILED',
      message: 'Users cannot delete themselves.',
    });
    // Must not have invoked the cleanup callback.
    expect(deleteEntityWithValidationMock).not.toHaveBeenCalled();
  });

  it('reassigns NOT-NULL audit columns to the deleting actor', async () => {
    isEnterpriseRef.value = false;

    const { ops } = await runDeleteUser(new Set(CE_CLEANUP_TABLES));

    // documents.created_by is the canonical regression case from prod.
    const docOp = ops.find((o) => o.table === 'documents' && o.op === 'update');
    expect(docOp).toBeTruthy();
    expect(docOp!.values).toEqual({ created_by: ACTOR_USER_ID });
  });
});
