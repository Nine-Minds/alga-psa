import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { ITicket } from '../../interfaces/ticket.interfaces';
import * as ticketActions from '@product/actions/ticket-actions/ticketActions';
import { TestContext } from '../../../../test-utils/testContext';
import {
  setupCommonMocks,
  mockNextHeaders,
  mockNextAuth,
  mockRBAC,
  createMockUser
} from '../../../../test-utils/testMocks';
import {
  createTenant,
  createClient,
  createUser,
  createTestEnvironment
} from '../../../../test-utils/testDataFactory';
import {
  resetDatabase,
  createCleanupHook,
  cleanupTables
} from '../../../../test-utils/dbReset';
import {
  expectPermissionDenied,
  expectError
} from '../../../../test-utils/errorUtils';

describe('Ticket Permissions Infrastructure', () => {
  const context = new TestContext({
    cleanupTables: ['tickets', 'categories', 'boards', 'contacts', 'clients', 'users', 'roles', 'permissions'],
    runSeeds: true
  });
  let testTicket: ITicket;
  let regularUser: any;
  let adminUser: any;
  let boardId: string;
  let categoryId: string;
  let contactId: string;
  let statusId: string;
  let priorityId: string;

  // Set up test context with database connection
  beforeAll(async () => {
    await context.initialize();
  });

  afterAll(async () => {
    await context.cleanup();
  });

  beforeEach(async () => {
    // Reset database state
    await resetDatabase(context.db);

    // Set up common test environment
    const { tenantId, clientId } = await createTestEnvironment(context.db, {
      clientName: 'Test Client'
    });

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
    regularUser = await context.db('users')
      .select('users.*')
      .leftJoin('user_roles', 'users.user_id', 'user_roles.user_id')
      .leftJoin('roles', 'user_roles.role_id', 'roles.role_id')
      .where('users.user_id', regularUserId)
      .first();

    adminUser = await context.db('users')
      .select('users.*')
      .leftJoin('user_roles', 'users.user_id', 'user_roles.user_id')
      .leftJoin('roles', 'user_roles.role_id', 'roles.role_id')
      .where('users.user_id', adminUserId)
      .first();

    // Create board
    boardId = uuidv4();
    await context.db('boards').insert({
      board_id: boardId,
      board_name: 'Test Board',
      tenant: tenantId,
    });

    // Create contact
    contactId = uuidv4();
    await context.db('contacts').insert({
      contact_name_id: contactId,
      full_name: 'Test Contact',
      email: 'test@example.com',
      client_id: clientId,
      tenant: tenantId,
    });

    // Get priority ID from seeded data
    priorityId = (await context.db('priorities'))[0].priority_id;

    // Create category
    categoryId = uuidv4();
    await context.db('categories').insert({
      category_id: categoryId,
      category_name: 'Test Category',
      tenant: tenantId,
      board_id: boardId,
      created_by: adminUser.user_id,
    });

    // Create status
    statusId = uuidv4();
    const uniqueOrderNumber = Math.floor(Date.now() / 1000) % 1000000 + Math.floor(Math.random() * 1000);
    await context.db('statuses').insert({
      status_id: statusId,
      name: `Test Status ${uniqueOrderNumber}`,
      tenant: tenantId,
      created_by: adminUser.user_id,
      status_type: 'ticket',
      order_number: uniqueOrderNumber
    });

    // Set up mocks
    setupCommonMocks({
      tenantId,
      user: createMockUser('admin')
    });

    // Mock RBAC with proper type annotations
    mockRBAC((user: { username: string }, resource: string, action: string): boolean => {
      if (user.username === 'janeadmin') return true;
      if (user.username === 'johndoe' && resource === 'ticket' && action === 'read') return true;
      return false;
    });

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
      priority_id: priorityId,
      estimated_hours: undefined
    };

    await context.db('tickets').insert(testTicket);
  });

  // Use cleanup hook for test isolation
  const cleanup = createCleanupHook(context.db, [
    'tickets', 'categories', 'boards', 'contacts',
    'clients', 'users', 'roles', 'permissions'
  ]);
  afterEach(cleanup);

  it('should allow regular user to view tickets', async () => {
    const tickets = await ticketActions.getTickets(regularUser);
    expect(tickets.length).toBeGreaterThanOrEqual(1);
    expect(tickets.map((ticket): string => ticket.ticket_id!)).toContain(testTicket.ticket_id);
  });

  it('should allow admin user to update a ticket', async () => {
    const updateData: Partial<ITicket> = {
      status_id: statusId,
      updated_by: adminUser.user_id,
    };
    const result = await ticketActions.updateTicket(testTicket.ticket_id!, updateData, adminUser);
    expect(result).toBe('success');

    const updatedTicket = await context.db('tickets').where('ticket_id', testTicket.ticket_id).first();
    expect(updatedTicket.status_id).toBe(updateData.status_id);
  });

  it('should not allow regular user to update a ticket', async () => {
    const updateData: Partial<ITicket> = {
      status_id: statusId,
      updated_by: regularUser.user_id,
    };

    await expectPermissionDenied(
      () => ticketActions.updateTicket(testTicket.ticket_id!, updateData, regularUser)
    );

    const unchangedTicket = await context.db('tickets').where('ticket_id', testTicket.ticket_id).first();
    expect(unchangedTicket.status_id).toBe(testTicket.status_id);
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

    const newTicket = await ticketActions.addTicket(mockFormData, adminUser);
    expect(newTicket).toBeDefined();
    expect(newTicket?.title).toBe('New Test Ticket');

    if (newTicket?.ticket_id) {
      const retrievedTicket = await context.db('tickets').where('ticket_id', newTicket.ticket_id).first();
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

    await expectPermissionDenied(
      () => ticketActions.addTicket(mockFormData, regularUser)
    );
  });
});
