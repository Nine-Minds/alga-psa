import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  setupCommonMocks,
  createMockUser
} from '../../../../test-utils/testMocks';
import { v4 as uuidv4 } from 'uuid';
import type { ITicket } from '@alga-psa/types';
import * as ticketActions from '@alga-psa/tickets/actions/ticketActions';
import * as auth from '@alga-psa/auth';
import * as rbac from '@alga-psa/auth/rbac';
import { TestContext } from '../../../../test-utils/testContext';
import {
  createUser
} from '../../../../test-utils/testDataFactory';
import {
  expectPermissionDenied
} from '../../../../test-utils/errorUtils';
import { tenantDb } from '@alga-psa/db';

// Every ticket action is withAuth-wrapped, so the acting user comes from the
// session rather than from an argument. Without this mock the real withAuth
// resolves whatever the session stub points at, and both fixtures were denied.
vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

describe('Ticket Permissions Infrastructure', () => {
  const context = new TestContext({
    // No cleanupTables: each test runs in a transaction that is rolled back, and
    // TRUNCATE ... CASCADE on clients/users took the seeded statuses and
    // priorities with it — every fixture lookup then failed for the rest of the
    // file.
    runSeeds: true
  });
  let testTicket: ITicket & { tenant: string; client_id: string };
  let regularUser: any;
  let adminUser: any;
  let boardId: string;
  let categoryId: string;
  let contactId: string;
  let statusId: string;
  let priorityId: string;
  let regularRoleId: string;
  let realPermissionCheck: typeof rbac.hasPermission;

  function tenantScope(tenantId: string) {
    return tenantDb(context.db, tenantId);
  }

  function tenantTable(tenantId: string, table: string) {
    return tenantScope(tenantId).table(table);
  }

  // Set up test context with database connection
  beforeAll(async () => {
    await context.initialize();
    realPermissionCheck = (await vi.importActual<typeof rbac>('@alga-psa/auth/rbac')).hasPermission;
  });

  afterAll(async () => {
    await context.cleanup();
  });

  beforeEach(async () => {
    // Roll the per-test transaction back and open a fresh one. resetDatabase()
    // used to run here: it destroys the handle it is given and drops the
    // database out from under the context, so every query after the first
    // beforeEach failed with "not queryable".
    await context.reset();

    // Use the seeded tenant: createTestEnvironment mints a fresh one, which has
    // none of the seeded statuses or priorities these fixtures look up.
    const tenantId = context.tenantId;
    const clientId = context.clientId;

    // Create users with different roles
    const regularUserId = await createUser(context.db, tenantId, {
      username: 'johndoe',
      first_name: 'John',
      last_name: 'Doe',
      email: 'john@example.com',
      user_type: 'internal'
    });

    const adminUserId = await createUser(context.db, tenantId, {
      username: 'janeadmin',
      first_name: 'Jane',
      last_name: 'Admin',
      email: 'jane@example.com',
      user_type: 'internal'
    });

    // Get complete user objects from database
    const regularUserQuery = tenantTable(tenantId, 'users')
      .select('users.*')
      .where('users.user_id', regularUserId);
    tenantScope(tenantId).tenantJoin(regularUserQuery, 'user_roles', 'users.user_id', 'user_roles.user_id', { type: 'left' });
    tenantScope(tenantId).tenantJoin(regularUserQuery, 'roles', 'user_roles.role_id', 'roles.role_id', { type: 'left' });
    regularUser = await regularUserQuery.first();

    const adminUserQuery = tenantTable(tenantId, 'users')
      .select('users.*')
      .where('users.user_id', adminUserId);
    tenantScope(tenantId).tenantJoin(adminUserQuery, 'user_roles', 'users.user_id', 'user_roles.user_id', { type: 'left' });
    tenantScope(tenantId).tenantJoin(adminUserQuery, 'roles', 'user_roles.role_id', 'roles.role_id', { type: 'left' });
    adminUser = await adminUserQuery.first();

    // Create board
    boardId = uuidv4();
    await tenantTable(tenantId, 'boards').insert({
      board_id: boardId,
      board_name: 'Test Board',
      tenant: tenantId,
    });

    // Create contact
    contactId = uuidv4();
    await tenantTable(tenantId, 'contacts').insert({
      contact_name_id: contactId,
      full_name: 'Test Contact',
      email: 'test@example.com',
      client_id: clientId,
      tenant: tenantId,
    });

    // Get priority ID from seeded data
    priorityId = (await tenantTable(tenantId, 'priorities'))[0].priority_id;

    // Create category
    categoryId = uuidv4();
    await tenantTable(tenantId, 'categories').insert({
      category_id: categoryId,
      category_name: 'Test Category',
      tenant: tenantId,
      board_id: boardId,
      created_by: adminUser.user_id,
    });

    // Create status. board_id is required: creating a ticket validates that
    // its status belongs to its board (TicketModel.validateStatusBelongsToBoard),
    // and a boardless status fails that check.
    statusId = uuidv4();
    const uniqueOrderNumber = Math.floor(Date.now() / 1000) % 1000000 + Math.floor(Math.random() * 1000);
    await tenantTable(tenantId, 'statuses').insert({
      status_id: statusId,
      name: `Test Status ${uniqueOrderNumber}`,
      tenant: tenantId,
      created_by: adminUser.user_id,
      status_type: 'ticket',
      board_id: boardId,
      order_number: uniqueOrderNumber
    });

    // Set up mocks
    setupCommonMocks({
      tenantId,
      user: createMockUser('internal')
    });

    // Keep only the session/transaction seams. Permission decisions and role
    // hydration use production RBAC and the migrated database.
    vi.mocked(rbac.hasPermission).mockImplementation(realPermissionCheck);
    vi.mocked(auth.hasPermission).mockImplementation(realPermissionCheck);
    const grantRole = async (userId: string, actions: string[]) => {
      const roleId = uuidv4();
      await tenantTable(tenantId, 'roles').insert({
        tenant: tenantId, role_id: roleId, role_name: `Ticket test ${roleId}`,
        msp: true, client: false,
      });
      const permissions = await tenantTable(tenantId, 'permissions')
        .where({ resource: 'ticket', msp: true }).whereIn('action', actions)
        .select('permission_id', 'action');
      expect(new Set(permissions.map(permission => permission.action))).toEqual(new Set(actions));
      await tenantTable(tenantId, 'role_permissions').insert(permissions.map(permission => ({
        tenant: tenantId, role_id: roleId, permission_id: permission.permission_id,
      })));
      await tenantTable(tenantId, 'user_roles').insert({ tenant: tenantId, role_id: roleId, user_id: userId });
      return roleId;
    };
    regularRoleId = await grantRole(regularUser.user_id, ['read']);
    await grantRole(adminUser.user_id, ['read', 'update', 'create']);

    // Create test ticket
    testTicket = {
      tenant: tenantId,
      ticket_id: uuidv4(),
      ticket_number: 'TKT-001',
      title: 'Test Ticket',
      url: null,
      board_id: boardId,
      client_id: clientId,
      contact_name_id: contactId,
      status_id: statusId,
      category_id: categoryId,
      subcategory_id: null,
      entered_by: regularUser.user_id,
      updated_by: null,
      closed_by: null,
      assigned_to: null,
      entered_at: new Date().toISOString(),
      updated_at: null,
      closed_at: null,
      attributes: null,
      priority_id: priorityId
    };

    await tenantTable(tenantId, 'tickets').insert(testTicket);
  });

  // No cleanup hook: beforeEach rolls the per-test transaction back, which
  // already discards every fixture row. Deleting them by hand instead hit
  // role_permissions' foreign key on `permissions`, and that error aborts the
  // surrounding transaction — every later statement in the hook then failed
  // with "current transaction is aborted".

  it('should allow regular user to view tickets', async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValue(regularUser);
    const tickets = await ticketActions.getTickets();
    if (!Array.isArray(tickets)) throw new Error(JSON.stringify(tickets));
    expect(tickets.length).toBeGreaterThanOrEqual(1);
    expect(tickets.map((ticket): string => ticket.ticket_id!)).toContain(testTicket.ticket_id);
  });

  it('should allow admin user to update a ticket', async () => {
    const updateData: Partial<ITicket> = {
      title: 'Updated by authorized user',
      updated_by: adminUser.user_id,
    };
    vi.mocked(auth.getCurrentUser).mockResolvedValue(adminUser);
    const result = await ticketActions.updateTicket(testTicket.ticket_id!, updateData);
    expect(result).toBe('success');

    const updatedTicket = await tenantTable(testTicket.tenant, 'tickets').where('ticket_id', testTicket.ticket_id).first();
    expect(updatedTicket.title).toBe(updateData.title);
    expect(updatedTicket.updated_by).toBe(adminUser.user_id);
  });

  it('should not allow regular user to update a ticket', async () => {
    const updateData: Partial<ITicket> = {
      title: 'Unauthorized edit',
      updated_by: regularUser.user_id,
    };

    vi.mocked(auth.getCurrentUser).mockResolvedValue(regularUser);
    await expectPermissionDenied(
      () => ticketActions.updateTicket(testTicket.ticket_id!, updateData)
    );

    const unchangedTicket = await tenantTable(testTicket.tenant, 'tickets').where('ticket_id', testTicket.ticket_id).first();
    expect(unchangedTicket.title).toBe(testTicket.title);
    expect(unchangedTicket.updated_by).toBe(testTicket.updated_by);
  });

  it('should allow admin user to create a ticket', async () => {
    const mockFormData = new FormData();
    mockFormData.append('title', 'New Test Ticket');
    mockFormData.append('ticket_number', 'TKT-002');
    mockFormData.append('status_id', statusId);
    mockFormData.append('board_id', boardId);
    mockFormData.append('client_id', testTicket.client_id);
    mockFormData.append('contact_name_id', contactId);
    mockFormData.append('category_id', categoryId);
    mockFormData.append('priority_id', priorityId);

    vi.mocked(auth.getCurrentUser).mockResolvedValue(adminUser);
    const newTicket = await ticketActions.addTicket(mockFormData);
    if (!newTicket || !('ticket_id' in newTicket)) throw new Error(JSON.stringify(newTicket));
    expect(newTicket).toBeDefined();
    expect(newTicket?.title).toBe('New Test Ticket');

    if (newTicket?.ticket_id) {
      const retrievedTicket = await tenantTable(testTicket.tenant, 'tickets').where('ticket_id', newTicket.ticket_id).first();
      expect(retrievedTicket.ticket_id).toEqual(newTicket.ticket_id);
    } else {
      throw new Error('New ticket was not created successfully');
    }
  });

  it('should not allow regular user to create a ticket', async () => {
    const mockFormData = new FormData();
    mockFormData.append('title', 'New Test Ticket');
    mockFormData.append('ticket_number', 'TKT-002');
    mockFormData.append('status_id', statusId);
    mockFormData.append('board_id', boardId);
    mockFormData.append('client_id', testTicket.client_id);
    mockFormData.append('contact_name_id', contactId);
    mockFormData.append('category_id', categoryId);
    mockFormData.append('priority_id', priorityId);

    vi.mocked(auth.getCurrentUser).mockResolvedValue(regularUser);
    const before = await tenantTable(testTicket.tenant, 'tickets').select('ticket_id', 'title');
    await expectPermissionDenied(
      () => ticketActions.addTicket(mockFormData)
    );
    expect(await tenantTable(testTicket.tenant, 'tickets').select('ticket_id', 'title')).toEqual(before);
  });

  it('allows the administrator to read the persisted ticket', async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValue(adminUser);
    const result = await ticketActions.getTickets();
    expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ ticket_id: testTicket.ticket_id, title: testTicket.title })]));
  });

  it('denies reads immediately after the user role is revoked', async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValue(regularUser);
    expect(await ticketActions.getTickets()).toEqual(expect.arrayContaining([expect.objectContaining({ ticket_id: testTicket.ticket_id })]));
    await tenantTable(testTicket.tenant, 'user_roles').where({ user_id: regularUser.user_id }).delete();
    await expectPermissionDenied(() => ticketActions.getTickets());
  });

  it('does not grant an MSP user access through a client-only role', async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValue(regularUser);
    await tenantTable(testTicket.tenant, 'roles').where({ role_id: regularRoleId }).update({ msp: false, client: true });
    await expectPermissionDenied(() => ticketActions.getTickets());
  });

  it('denies reads when the role no longer grants the read permission', async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValue(regularUser);
    await tenantTable(testTicket.tenant, 'role_permissions').where({ role_id: regularRoleId }).delete();
    await expectPermissionDenied(() => ticketActions.getTickets());
  });

});
