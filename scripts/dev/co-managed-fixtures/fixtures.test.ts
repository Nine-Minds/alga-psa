import { describe, expect, it, vi } from 'vitest';
vi.mock('@alga-psa/db/models/user', () => ({ default: { getUserRolesWithPermissions: vi.fn() } }));
import User from '@alga-psa/db/models/user';
import { id, resolveModules, type FixtureModule } from './shared';
import { parseArgs, parseEnvFile, REGISTRY, run } from './index';
import { DISPOSABLE_CLIENTS, L1A_CAPACITY, l1aModule } from './L1a';
import { l9Module } from './L9';
import {
  notificationModule, NOTIFICATION_CUSTOMER, NOTIFICATION_SPONSOR, NOTIFICATION_USERS,
  NOTIFICATION_CUSTOMER_ADMIN, NOTIFICATION_OPERATION, NOTIFICATION_ALLOCATION,
  NOTIFICATION_RELATIONSHIP, NOTIFICATION_TICKET, NOTIFICATION_SPONSOR_HOME_CLIENT,
} from './notification';

const mod = (name: string, requires: string[] = []): FixtureModule => ({
  name, requires, apply: vi.fn(async () => {}), verify: vi.fn(async () => []), reset: vi.fn(async () => {}),
});

type Rows = Record<string, Record<string, any>[]>;

function notificationRows(): Rows {
  const rows: Rows = {
    tenants: [{ tenant: NOTIFICATION_CUSTOMER, product_code: 'co_managed' }, { tenant: NOTIFICATION_SPONSOR, product_code: 'psa' }],
    tenant_companies: [{ tenant: NOTIFICATION_CUSTOMER, client_id: id('client/notification-customer'), is_default: true },
      { tenant: NOTIFICATION_SPONSOR, client_id: NOTIFICATION_SPONSOR_HOME_CLIENT, is_default: true }],
    co_management_relationships: [{ tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP, sponsor_tenant: NOTIFICATION_SPONSOR, state: 'active' }],
    tickets: [{ tenant: NOTIFICATION_CUSTOMER, ticket_id: NOTIFICATION_TICKET }],
    co_management_ticket_work: [{ tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP, ticket_id: NOTIFICATION_TICKET, work_id: id('work/notification-customer') }],
    co_managed_provisioning_operations: [{ tenant: NOTIFICATION_SPONSOR, operation_id: NOTIFICATION_OPERATION, customer_tenant: NOTIFICATION_CUSTOMER,
      relationship_id: NOTIFICATION_RELATIONSHIP, request: { clientId: id('client/notification-sponsor') }, escalation_board_id: id('board/notification-sponsor') }],
    co_managed_allocations: [{ tenant: NOTIFICATION_SPONSOR, allocation_id: NOTIFICATION_ALLOCATION, operation_id: NOTIFICATION_OPERATION,
      customer_tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP, state: 'active' }],
    co_managed_entitlements: [{ tenant: NOTIFICATION_SPONSOR, source: 'admin_grant', capacity: 2 }],
    tenant_email_settings: [NOTIFICATION_SPONSOR, NOTIFICATION_CUSTOMER].map(tenant => ({ tenant, email_provider: 'smtp', provider_configs: [
      { providerId: `notification-local-smtp-${tenant}`, providerType: 'smtp', isEnabled: true, config: { host: '127.0.0.1', port: 3025 } },
    ] })),
    users: [
      ...NOTIFICATION_USERS.map(user => ({ tenant: NOTIFICATION_SPONSOR, user_id: user.userId, user_type: 'internal', is_inactive: false, hashed_password: `valid:${user.password}` })),
      { tenant: NOTIFICATION_CUSTOMER, user_id: NOTIFICATION_CUSTOMER_ADMIN.userId, user_type: 'internal', is_inactive: false, hashed_password: `valid:${NOTIFICATION_CUSTOMER_ADMIN.password}` },
    ],
    roles: [{ tenant: NOTIFICATION_CUSTOMER, role_id: id('role/notification-customer-admin'), msp: true, client: false }],
    user_roles: [{ tenant: NOTIFICATION_CUSTOMER, user_id: NOTIFICATION_CUSTOMER_ADMIN.userId, role_id: id('role/notification-customer-admin') }],
    permissions: [
      { tenant: NOTIFICATION_CUSTOMER, permission_id: id('permission/notification-customer-ticket-read'), resource: 'ticket', action: 'read', msp: true, client: false },
      { tenant: NOTIFICATION_CUSTOMER, permission_id: id('permission/notification-customer-ticket-update'), resource: 'ticket', action: 'update', msp: true, client: false },
    ],
    role_permissions: [
      { tenant: NOTIFICATION_CUSTOMER, role_id: id('role/notification-customer-admin'), permission_id: id('permission/notification-customer-ticket-read') },
      { tenant: NOTIFICATION_CUSTOMER, role_id: id('role/notification-customer-admin'), permission_id: id('permission/notification-customer-ticket-update') },
    ], co_management_staff_assignments: [],
    authorization_bundle_assignments: [], authorization_bundle_rules: [],
  };
  for (const user of NOTIFICATION_USERS) {
    const roleId = id(`role/notification-${user.key}`);
    const policy = id(`authorization/notification-${user.key}`);
    rows.roles.push({ tenant: NOTIFICATION_SPONSOR, role_id: roleId });
    rows.user_roles.push({ tenant: NOTIFICATION_SPONSOR, user_id: user.userId, role_id: roleId });
    for (const permissionSlug of ['ticket-read', 'client-read', 'management-read', 'management-manage']) {
      rows.role_permissions.push({ tenant: NOTIFICATION_SPONSOR, role_id: roleId,
        permission_id: id(`permission/notification-${permissionSlug}`) });
    }
    rows.co_management_staff_assignments.push({ tenant: NOTIFICATION_SPONSOR, customer_tenant: NOTIFICATION_CUSTOMER,
      relationship_id: NOTIFICATION_RELATIONSHIP, principal_type: 'user', principal_id: user.userId });
    rows.authorization_bundle_assignments.push({ tenant: NOTIFICATION_SPONSOR, assignment_id: id(`authorization/notification-${user.key}/assignment`), target_id: user.userId, status: 'active' });
    rows.authorization_bundle_rules.push({ tenant: NOTIFICATION_SPONSOR, rule_id: id(`authorization/notification-${user.key}/rule`), config: { redactedFields: user.hidden } });
  }
  return rows;
}

function memoryDb(rows: Rows): any {
  return (table: string) => {
    const filters: Array<(row: Record<string, any>) => boolean> = [];
    const query: any = {
      where: (condition: Record<string, any>) => { filters.push(row => Object.entries(condition).every(([key, value]) => row[key] === value)); return query; },
      first: async () => rows[table]?.find(row => filters.every(filter => filter(row))) ?? undefined,
      then: (resolve: (value: any) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows[table]?.filter(row => filters.every(filter => filter(row))) ?? []).then(resolve, reject),
    };
    return query;
  };
}

function memoryTrx(rows: Rows): any {
  return (table: string) => {
    const filters: Array<(row: Record<string, any>) => boolean> = [];
    const query: any = {
      where: (condition: Record<string, any>) => { filters.push(row => Object.entries(condition).every(([key, value]) => row[key] === value)); return query; },
      andWhere: (condition: Record<string, any>) => query.where(condition),
      whereIn: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
      select: () => query,
      first: async () => (rows[table] ?? []).find(row => filters.every(filter => filter(row))) ?? undefined,
      then: (resolve: (value: any) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve((rows[table] ?? []).filter(row => filters.every(filter => filter(row)))).then(resolve, reject),
      delete: async () => { rows[table] = (rows[table] ?? []).filter(row => !filters.every(filter => filter(row))); },
      update: async (patch: Record<string, unknown>) => { for (const row of rows[table] ?? []) if (filters.every(filter => filter(row))) Object.assign(row, patch); },
    };
    return query;
  };
}

function memoryStore(rows: Rows = {}): any {
  const database = (table: string) => {
    const filters: Array<(row: Record<string, any>) => boolean> = [];
    let pendingInsert: Record<string, any>[] = [];
    let conflictKeys: string[] = [];
    const query: any = {
      where: (condition: Record<string, any>) => { filters.push(row => Object.entries(condition).every(([key, value]) => row[key] === value)); return query; },
      first: async () => (rows[table] ?? []).find(row => filters.every(filter => filter(row))) ?? undefined,
      insert: (input: Record<string, any> | Record<string, any>[]) => { pendingInsert = Array.isArray(input) ? input : [input]; return query; },
      onConflict: (keys: string[]) => { conflictKeys = keys; return query; },
      merge: () => query,
      update: async (patch: Record<string, unknown>) => {
        let updated = 0;
        for (const row of rows[table] ?? []) if (filters.every(filter => filter(row))) { Object.assign(row, patch); updated++; }
        return updated;
      },
      then: (resolve: (value: any) => unknown, reject: (reason: unknown) => unknown) => {
        if (pendingInsert.length) {
          rows[table] ??= [];
          for (const input of pendingInsert) {
            const existing = conflictKeys.length ? rows[table].find(row => conflictKeys.every(key => row[key] === input[key])) : undefined;
            if (existing) Object.assign(existing, input);
            else rows[table].push({ ...input });
          }
          return Promise.resolve(pendingInsert.length).then(resolve, reject);
        }
        return Promise.resolve((rows[table] ?? []).filter(row => filters.every(filter => filter(row)))).then(resolve, reject);
      },
    };
    return query;
  };
  database.rows = rows;
  database.transaction = async (callback: (trx: any) => Promise<unknown>) => callback(database);
  return database;
}

describe('co-managed fixtures', () => {
  it('resolves dependencies first and each module once', () => {
    const [a, b, c] = [mod('base'), mod('L1a', ['base']), mod('L2', ['L1a', 'base'])];
    expect(resolveModules([c, b, a], 'L2').map(m => m.name)).toEqual(['base', 'L1a', 'L2']);
    expect(() => resolveModules([a], 'nope')).toThrow(/Unknown/);
    expect(() => resolveModules([mod('x', ['y']), mod('y', ['x'])], 'x')).toThrow(/cycle/);
  });

  it('L1a requires base and derives stable ids from slugs', () => {
    expect(l1aModule.requires).toEqual(['base']);
    expect(REGISTRY.map(m => m.name)).toEqual(['base', 'L1a', 'notification', 'L9']);
    expect(DISPOSABLE_CLIENTS.map(c => c.clientId)).toEqual([id('client/oz/disposable-enable'), id('client/oz/disposable-cancel')]);
    expect(id('x')).toBe(id('x'));
  });

  it('L9 declares its L1a parent and resolves after it', () => {
    expect(l9Module.requires).toEqual(['L1a']);
    expect(resolveModules(REGISTRY, 'L9').map(m => m.name)).toEqual(['base', 'L1a', 'L9']);
  });

  it('notification layer owns distinct stable customer, sponsor identities, and per-recipient policies', () => {
    expect(notificationModule.requires).toEqual([]);
    expect(resolveModules(REGISTRY, 'notification').map(m => m.name)).toEqual(['notification']);
    expect(NOTIFICATION_CUSTOMER).toBe(id('tenant/notification-customer'));
    expect(NOTIFICATION_SPONSOR).toBe(id('tenant/notification-sponsor'));
    expect(NOTIFICATION_USERS.map(user => user.userId)).toEqual([
      id('user/notification-sponsor/redacted'), id('user/notification-sponsor/visible'),
    ]);
    expect(NOTIFICATION_USERS[0].hidden).toContain('tickets.title');
    expect(NOTIFICATION_USERS[1].hidden).toEqual([]);
  });

  it('applies effective internal ticket permissions and verification detects authorization regressions', async () => {
    const db = memoryStore();
    const engines = {
      hashPassword: async (password: string) => `hash:${password}`,
      verifyPassword: async (password: string, stored: string) => stored === `hash:${password}`,
    } as any;
    const loadAppliedRoles = async (_connection: any, userId: string) => {
      const rows = db.rows as Rows;
      return (rows.user_roles ?? []).filter(row => row.tenant === NOTIFICATION_CUSTOMER && row.user_id === userId).map(membership => {
        const role = rows.roles.find(row => row.tenant === NOTIFICATION_CUSTOMER && row.role_id === membership.role_id)!;
        const permissions = (rows.role_permissions ?? []).filter(row => row.tenant === NOTIFICATION_CUSTOMER && row.role_id === role.role_id)
          .map(link => rows.permissions.find(row => row.tenant === NOTIFICATION_CUSTOMER && row.permission_id === link.permission_id)!)
          .map(permission => ({ permission_id: permission.permission_id, resource: permission.resource, action: permission.action,
            msp: permission.msp, client: permission.client }));
        return { ...role, role_name: 'Notification customer admin', permissions };
      });
    };
    vi.mocked(User.getUserRolesWithPermissions).mockImplementation(loadAppliedRoles as any);

    await notificationModule.apply(db, engines);
    const author = db.rows.users.find((row: any) => row.tenant === NOTIFICATION_CUSTOMER && row.user_id === NOTIFICATION_CUSTOMER_ADMIN.userId);
    expect(await User.getUserRolesWithPermissions(db, NOTIFICATION_CUSTOMER_ADMIN.userId)).toHaveLength(1);
    expect(await import('@alga-psa/auth/rbac').then(({ hasPermission }) => hasPermission(author, 'ticket', 'read', db))).toBe(true);
    const { hasPermission } = await import('@alga-psa/auth/rbac');
    expect(await hasPermission(author, 'ticket', 'update', db)).toBe(true);
    const report = async (detail: string) => (await notificationModule.verify(db, engines)).find(item => item.detail === detail)?.ok;
    expect(await report('fixture customer admin passes runtime ticket:read authorization')).toBe(true);
    expect(await report('fixture customer admin passes runtime ticket authorization for Shared IT comments')).toBe(true);

    const role = db.rows.roles.find((row: any) => row.tenant === NOTIFICATION_CUSTOMER && row.role_id === id('role/notification-customer-admin'));
    const permissions = db.rows.permissions.filter((row: any) => row.tenant === NOTIFICATION_CUSTOMER);
    const hasMembership = () => db.rows.user_roles.some((row: any) => row.tenant === NOTIFICATION_CUSTOMER && row.user_id === NOTIFICATION_CUSTOMER_ADMIN.userId);
    role.msp = false;
    expect(hasMembership()).toBe(true);
    expect(await hasPermission(author, 'ticket', 'read', db)).toBe(false);
    expect(await report('fixture customer admin passes runtime ticket:read authorization')).toBe(false);
    role.msp = true;
    permissions.forEach((permission: any) => { permission.msp = false; });
    expect(hasMembership()).toBe(true);
    expect(await hasPermission(author, 'ticket', 'read', db)).toBe(false);
    expect(await report('fixture customer admin passes runtime ticket:read authorization')).toBe(false);
    permissions.forEach((permission: any) => { permission.msp = true; });
    db.rows.role_permissions = db.rows.role_permissions.filter((row: any) => row.tenant !== NOTIFICATION_CUSTOMER ||
      row.permission_id !== id('permission/notification-customer-ticket-update'));
    expect(hasMembership()).toBe(true);
    expect(await hasPermission(author, 'ticket', 'update', db)).toBe(false);
    expect(await report('fixture customer admin passes runtime ticket authorization for Shared IT comments')).toBe(false);
    vi.mocked(User.getUserRolesWithPermissions).mockReset();
  });

  it('notification verification rejects missing credentials, staff memberships, operation locator, allocation, and SMTP', async () => {
    const base = notificationRows();
    const engines = { verifyPassword: async (password: string, stored: string) => stored === `valid:${password}` } as any;
    let activeRows = base;
    vi.mocked(User.getUserRolesWithPermissions).mockImplementation(async (_db: any, userId: string) => {
      const memberships = activeRows.user_roles.filter(row => row.tenant === NOTIFICATION_CUSTOMER && row.user_id === userId);
      return memberships.map(membership => {
        const role = activeRows.roles.find(row => row.tenant === NOTIFICATION_CUSTOMER && row.role_id === membership.role_id)!;
        const permissions = activeRows.role_permissions.filter(row => row.tenant === NOTIFICATION_CUSTOMER && row.role_id === role.role_id)
          .map(link => activeRows.permissions.find(row => row.tenant === NOTIFICATION_CUSTOMER && row.permission_id === link.permission_id)!)
          .map(permission => ({ permission_id: permission.permission_id, resource: permission.resource, action: permission.action,
            msp: permission.msp, client: permission.client }));
        return { ...role, role_name: 'Notification customer admin', permissions };
      }) as any;
    });
    const initialReports = await notificationModule.verify(memoryDb(base), engines);
    expect(initialReports.filter(report => !report.ok).map(report => report.detail)).toEqual([]);
    expect(initialReports.find(report => report.detail.includes('runtime ticket:read'))?.ok).toBe(true);
    expect(initialReports.find(report => report.detail.includes('Shared IT comments'))?.ok).toBe(true);

    const missing: Array<[string, (rows: Rows) => void]> = [
      ['redacted login credential', rows => { rows.users[0].hashed_password = null; }],
      ['visible login credential', rows => { rows.users[1].hashed_password = null; }],
      ['customer admin credential', rows => { rows.users[2].hashed_password = null; }],
      ['redacted recipient staff membership', rows => { rows.co_management_staff_assignments = rows.co_management_staff_assignments.filter(row => row.principal_id !== NOTIFICATION_USERS[0].userId); }],
      ['visible recipient staff membership', rows => { rows.co_management_staff_assignments = rows.co_management_staff_assignments.filter(row => row.principal_id !== NOTIFICATION_USERS[1].userId); }],
      ['sponsor role membership', rows => { rows.user_roles = rows.user_roles.filter(row => row.tenant !== NOTIFICATION_SPONSOR || row.user_id !== NOTIFICATION_USERS[0].userId); }],
      ['co-management UI permission', rows => { rows.role_permissions = rows.role_permissions.filter(row => row.permission_id !== id('permission/notification-management-manage')); }],
      ['customer admin role membership', rows => { rows.user_roles = rows.user_roles.filter(row => row.user_id !== NOTIFICATION_CUSTOMER_ADMIN.userId); }],
      ['default company context', rows => { rows.tenant_companies = []; }],
      ['provisioning operation', rows => { rows.co_managed_provisioning_operations = []; }],
      ['operation target mapping', rows => { rows.co_managed_provisioning_operations[0].request.clientId = id('client/wrong-target'); }],
      ['active allocation', rows => { rows.co_managed_allocations[0].state = 'released'; }],
      ['capacity entitlement', rows => { rows.co_managed_entitlements = []; }],
      ['sponsor local SMTP settings', rows => { rows.tenant_email_settings = rows.tenant_email_settings.filter(row => row.tenant !== NOTIFICATION_SPONSOR); }],
      ['customer local SMTP settings', rows => { rows.tenant_email_settings = rows.tenant_email_settings.filter(row => row.tenant !== NOTIFICATION_CUSTOMER); }],
      ['fixture SMTP listener port', rows => { rows.tenant_email_settings[0].provider_configs[0].config.port = 1025; }],
    ];
    for (const [name, remove] of missing) {
      const rows = structuredClone(base);
      remove(rows);
      activeRows = rows;
      const reports = await notificationModule.verify(memoryDb(rows), engines);
      expect(reports.some(report => !report.ok), name).toBe(true);
      if (name === 'sponsor local SMTP settings' || name === 'customer local SMTP settings') {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        expect(await run(memoryDb(rows) as never, { through: 'notification', only: 'notification', mode: 'verify' },
          async () => engines, [notificationModule]), name).toBe(false);
        vi.restoreAllMocks();
      }
    }
    vi.mocked(User.getUserRolesWithPermissions).mockReset();
  });

  it('notification reset removes only its owned records and preserves unrelated QA rows', async () => {
    const rows: Rows = {
      tenants: [{ tenant: NOTIFICATION_CUSTOMER }, { tenant: NOTIFICATION_SPONSOR }, { tenant: id('tenant/oz') }, { tenant: id('tenant/shared-qa') }],
      users: [{ tenant: NOTIFICATION_SPONSOR, user_id: NOTIFICATION_USERS[0].userId },
        { tenant: id('tenant/oz'), user_id: id('user/oz/unrelated') },
        { tenant: id('tenant/shared-qa'), user_id: id('user/shared') }],
      sessions: [{ tenant: NOTIFICATION_SPONSOR, user_id: NOTIFICATION_USERS[0].userId },
        { tenant: NOTIFICATION_CUSTOMER, user_id: NOTIFICATION_CUSTOMER_ADMIN.userId },
        { tenant: id('tenant/shared-qa'), user_id: id('user/shared') }],
      tenant_email_settings: [...[NOTIFICATION_SPONSOR, NOTIFICATION_CUSTOMER].map(tenant => ({ tenant, email_provider: 'microsoft',
        provider_configs: [{ providerId: `notification-local-smtp-${tenant}`, providerType: 'smtp', isEnabled: true },
          { providerId: `unrelated-${tenant}`, providerType: 'microsoft', isEnabled: true }] })),
        { tenant: id('tenant/shared-qa'), provider_configs: [{ providerId: 'shared', providerType: 'smtp', isEnabled: true }] }],
      co_managed_provisioning_operations: [{ tenant: NOTIFICATION_SPONSOR, operation_id: NOTIFICATION_OPERATION }, { tenant: id('tenant/shared-qa'), operation_id: id('operation/shared') }],
      co_managed_allocations: [{ tenant: NOTIFICATION_SPONSOR, allocation_id: NOTIFICATION_ALLOCATION }, { tenant: id('tenant/shared-qa'), allocation_id: id('allocation/shared') }],
      tickets: [{ tenant: NOTIFICATION_CUSTOMER, ticket_id: NOTIFICATION_TICKET }, { tenant: id('tenant/shared-qa'), ticket_id: id('ticket/shared') }],
      co_management_staff_assignments: [{ tenant: NOTIFICATION_SPONSOR, customer_tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP },
        { tenant: id('tenant/shared-qa'), customer_tenant: id('tenant/other'), relationship_id: id('relationship/shared') }],
      authorization_bundle_assignments: [
        { tenant: id('tenant/oz'), assignment_id: id('authorization/notification-redacted/assignment') },
        { tenant: id('tenant/oz'), assignment_id: id('authorization/unrelated/assignment') },
      ],
      authorization_bundle_rules: [
        { tenant: id('tenant/oz'), rule_id: id('authorization/notification-redacted/rule') },
        { tenant: id('tenant/oz'), rule_id: id('authorization/unrelated/rule') },
      ],
      authorization_bundles: [
        { tenant: id('tenant/oz'), bundle_id: id('authorization/notification-redacted/bundle'), published_revision_id: id('authorization/notification-redacted/revision') },
        { tenant: id('tenant/oz'), bundle_id: id('authorization/unrelated/bundle'), published_revision_id: id('authorization/unrelated/revision') },
      ],
      authorization_bundle_revisions: [
        { tenant: id('tenant/oz'), revision_id: id('authorization/notification-redacted/revision') },
        { tenant: id('tenant/oz'), revision_id: id('authorization/unrelated/revision') },
      ],
      roles: [
        { tenant: id('tenant/oz'), role_id: id('role/oz/notification-redacted') },
        { tenant: id('tenant/oz'), role_id: id('role/oz/unrelated') },
      ],
      permissions: [
        { tenant: id('tenant/oz'), permission_id: id('permission/oz/notification-ticket-read') },
        { tenant: id('tenant/oz'), permission_id: id('permission/oz/unrelated') },
      ],
      role_permissions: [
        { tenant: id('tenant/oz'), permission_id: id('permission/oz/notification-ticket-read') },
        { tenant: id('tenant/oz'), permission_id: id('permission/oz/unrelated') },
      ],
    };
    await notificationModule.reset(memoryTrx(rows));
    expect(rows.tenants).toEqual([{ tenant: id('tenant/oz') }, { tenant: id('tenant/shared-qa') }]);
    expect(rows.users).toEqual([{ tenant: id('tenant/oz'), user_id: id('user/oz/unrelated') },
      { tenant: id('tenant/shared-qa'), user_id: id('user/shared') }]);
    expect(rows.sessions).toEqual([{ tenant: id('tenant/shared-qa'), user_id: id('user/shared') }]);
    expect(rows.tenant_email_settings).toEqual([
      { tenant: NOTIFICATION_SPONSOR, email_provider: 'microsoft', provider_configs: JSON.stringify([{ providerId: `unrelated-${NOTIFICATION_SPONSOR}`, providerType: 'microsoft', isEnabled: true }]) },
      { tenant: NOTIFICATION_CUSTOMER, email_provider: 'microsoft', provider_configs: JSON.stringify([{ providerId: `unrelated-${NOTIFICATION_CUSTOMER}`, providerType: 'microsoft', isEnabled: true }]) },
      { tenant: id('tenant/shared-qa'), provider_configs: [{ providerId: 'shared', providerType: 'smtp', isEnabled: true }] },
    ]);
    expect(rows.co_managed_provisioning_operations).toEqual([{ tenant: id('tenant/shared-qa'), operation_id: id('operation/shared') }]);
    expect(rows.co_managed_allocations).toEqual([{ tenant: id('tenant/shared-qa'), allocation_id: id('allocation/shared') }]);
    expect(rows.tickets).toEqual([{ tenant: id('tenant/shared-qa'), ticket_id: id('ticket/shared') }]);
    expect(rows.co_management_staff_assignments).toEqual([{ tenant: id('tenant/shared-qa'), customer_tenant: id('tenant/other'), relationship_id: id('relationship/shared') }]);
    expect(rows.authorization_bundle_assignments).toEqual([{ tenant: id('tenant/oz'), assignment_id: id('authorization/unrelated/assignment') }]);
    expect(rows.authorization_bundle_rules).toEqual([{ tenant: id('tenant/oz'), rule_id: id('authorization/unrelated/rule') }]);
    expect(rows.authorization_bundles).toEqual([{ tenant: id('tenant/oz'), bundle_id: id('authorization/unrelated/bundle'), published_revision_id: id('authorization/unrelated/revision') }]);
    expect(rows.authorization_bundle_revisions).toEqual([{ tenant: id('tenant/oz'), revision_id: id('authorization/unrelated/revision') }]);
    expect(rows.roles).toEqual([{ tenant: id('tenant/oz'), role_id: id('role/oz/unrelated') }]);
    expect(rows.permissions).toEqual([{ tenant: id('tenant/oz'), permission_id: id('permission/oz/unrelated') }]);
    expect(rows.role_permissions).toEqual([{ tenant: id('tenant/oz'), permission_id: id('permission/oz/unrelated') }]);
  });

  it('applies in order inside one transaction and resets in reverse', async () => {
    const order: string[] = [];
    const [a, b] = [mod('base'), mod('L1a', ['base'])];
    a.apply = vi.fn(async () => { order.push('apply base'); });
    b.apply = vi.fn(async () => { order.push('apply L1a'); });
    a.reset = vi.fn(async () => { order.push('reset base'); });
    b.reset = vi.fn(async () => { order.push('reset L1a'); });
    const db: any = { transaction: async (work: (t: unknown) => Promise<void>) => work({}) };
    const engines = vi.fn(async () => ({}) as never);
    await run(db, { through: 'L1a', mode: 'apply' }, engines, [a, b]);
    await run(db, { through: 'L1a', mode: 'reset' }, engines, [a, b]);
    expect(order).toEqual(['apply base', 'apply L1a', 'reset L1a', 'reset base']);
    expect(engines).toHaveBeenCalledTimes(1);
  });

  it('applies only the requested layer after checking its prerequisites', async () => {
    const order: string[] = [];
    const base = mod('base'), target = mod('notification', ['base']), unrelated = mod('other');
    base.verify = vi.fn(async () => { order.push('verify base'); return [{ ok: true, area: 'base', detail: 'ready' }]; });
    base.apply = vi.fn(async () => { order.push('apply base'); });
    target.apply = vi.fn(async () => { order.push('apply notification'); });
    unrelated.apply = vi.fn(async () => { order.push('apply other'); });
    const db: any = { transaction: async (work: (t: unknown) => Promise<void>) => work({}) };
    await run(db, { through: 'other', only: 'notification', mode: 'apply' }, async () => ({}) as never, [base, target, unrelated]);
    expect(order).toEqual(['verify base', 'apply notification']);
  });

  it('verify fails when a module reports a mismatch and never loads engines', async () => {
    const m = mod('base');
    m.verify = vi.fn(async () => [{ ok: false, area: 'base', detail: 'bad' }]);
    const engines = vi.fn();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await run({} as never, { through: 'base', mode: 'verify' }, engines as never, [m])).toBe(false);
    expect(engines).not.toHaveBeenCalled();
  });

  it('L1a verify asserts one unsigned grant, no live disposable setup, no stray co_managed tenant', async () => {
    const results: Record<string, unknown> = {
      co_managed_entitlements: [{ source: 'admin_grant', source_reference: 'fixture:l1a', capacity: L1A_CAPACITY, signed_license: null }],
    };
    const chain = (rows: unknown): any => {
      const c: any = new Proxy(function () {}, {
        get: (_t, prop) => prop === 'then' ? (res: (v: unknown) => void) => res(rows) : () => c,
      });
      return c;
    };
    const db: any = (table: string) => chain(
      table === 'co_managed_entitlements' ? results[table] : table === 'tenants' ? [] : [{ count: '0' }]);
    const reports = await l1aModule.verify(db);
    expect(reports.every(r => r.ok)).toBe(true);
    results.co_managed_entitlements = [...(results.co_managed_entitlements as unknown[]), {}];
    expect((await l1aModule.verify(db)).some(r => !r.ok)).toBe(true);
  });

  it('parses env files without a shell and CLI flags', () => {
    expect(parseEnvFile('A=1\n# c\nB="x&y"\n')).toEqual({ A: '1', B: 'x&y' });
    expect(parseArgs(['--through', 'base', '--verify'])).toEqual({ through: 'base', mode: 'verify' });
    expect(parseArgs(['--only', 'notification'])).toEqual({ through: 'L9', only: 'notification', mode: 'apply' });
    expect(parseArgs([])).toEqual({ through: 'L9', mode: 'apply' });
  });
});
