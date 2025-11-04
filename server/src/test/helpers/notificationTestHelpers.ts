import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

/**
 * Test Helpers for Internal Notifications
 *
 * Reusable utilities for setting up test data and making assertions
 * in internal notification tests.
 */

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Create a test user in the database
 */
export async function createTestUser(
  db: Knex,
  tenant: string,
  overrides: Partial<{
    user_id: string;
    username: string;
    first_name: string;
    last_name: string;
    email: string;
    is_active: boolean;
    user_type: 'internal' | 'client';
  }> = {}
) {
  const userId = overrides.user_id || uuidv4();

  const user = {
    user_id: userId,
    tenant,
    username: overrides.username || `user_${userId.slice(0, 8)}`,
    first_name: overrides.first_name || 'Test',
    last_name: overrides.last_name || 'User',
    email: overrides.email || `test_${userId.slice(0, 8)}@example.com`,
    is_active: overrides.is_active !== undefined ? overrides.is_active : true,
    user_type: overrides.user_type || 'internal',
    password: 'hashed_password', // Mock password
    hris_id: null,
    contact_id: null
  };

  await db('users').insert(user);
  return user;
}

/**
 * Create a test ticket in the database
 */
export async function createTestTicket(
  db: Knex,
  tenant: string,
  overrides: Partial<{
    ticket_id: string;
    ticket_number: string;
    title: string;
    assigned_to: string | null;
    client_id: string | null;
    contact_name_id: string | null;
  }> = {}
) {
  const ticketId = overrides.ticket_id || uuidv4();

  const ticket = {
    ticket_id: ticketId,
    tenant,
    ticket_number: overrides.ticket_number || `T-${Math.floor(Math.random() * 10000)}`,
    title: overrides.title || 'Test Ticket',
    assigned_to: overrides.assigned_to || null,
    client_id: overrides.client_id || null,
    contact_name_id: overrides.contact_name_id || null,
    status: 'open',
    priority_id: 1
  };

  await db('tickets').insert(ticket);
  return ticket;
}

/**
 * Create a test comment in the database
 */
export async function createTestComment(
  db: Knex,
  tenant: string,
  ticketId: string,
  userId: string,
  overrides: Partial<{
    comment_id: string;
    note: string;
    markdown_content: string;
    is_internal: boolean;
    author_type: string;
  }> = {}
) {
  const commentId = overrides.comment_id || uuidv4();

  const comment = {
    comment_id: commentId,
    tenant,
    ticket_id: ticketId,
    user_id: userId,
    note: overrides.note || '{"type":"doc","content":[]}',
    markdown_content: overrides.markdown_content || 'Test comment',
    is_internal: overrides.is_internal !== undefined ? overrides.is_internal : false,
    is_resolution: false,
    author_type: overrides.author_type || 'internal'
  };

  await db('comments').insert(comment);
  return comment;
}

/**
 * Create a test notification template
 */
export async function createTestTemplate(
  db: Knex,
  overrides: Partial<{
    name: string;
    language_code: string;
    title: string;
    message: string;
    subtype_id: number;
  }> = {}
) {
  const template = {
    name: overrides.name || 'test-template',
    language_code: overrides.language_code || 'en',
    title: overrides.title || 'Test {{variable}}',
    message: overrides.message || 'Test message {{variable}}',
    subtype_id: overrides.subtype_id || 1
  };

  const [inserted] = await db('internal_notification_templates')
    .insert(template)
    .returning('*');

  return inserted;
}

/**
 * Create a test notification
 */
export async function createTestNotification(
  db: Knex,
  tenant: string,
  userId: string,
  overrides: Partial<{
    template_name: string;
    title: string;
    message: string;
    type: string;
    category: string;
    link: string;
    is_read: boolean;
    metadata: Record<string, any>;
  }> = {}
) {
  const notification = {
    tenant,
    user_id: userId,
    template_name: overrides.template_name || 'test-template',
    language_code: 'en',
    title: overrides.title || 'Test Notification',
    message: overrides.message || 'Test message',
    type: overrides.type || 'info',
    category: overrides.category || null,
    link: overrides.link || null,
    is_read: overrides.is_read !== undefined ? overrides.is_read : false,
    metadata: overrides.metadata ? JSON.stringify(overrides.metadata) : null,
    delivery_status: 'pending',
    delivery_attempts: 0
  };

  const [inserted] = await db('internal_notifications')
    .insert(notification)
    .returning('*');

  return inserted;
}

/**
 * Create test user preference
 */
export async function createTestPreference(
  db: Knex,
  tenant: string,
  userId: string,
  overrides: Partial<{
    category_id: number | null;
    subtype_id: number | null;
    is_enabled: boolean;
  }> = {}
) {
  const preference = {
    tenant,
    user_id: userId,
    category_id: overrides.category_id || null,
    subtype_id: overrides.subtype_id || null,
    is_enabled: overrides.is_enabled !== undefined ? overrides.is_enabled : true
  };

  const [inserted] = await db('user_internal_notification_preferences')
    .insert(preference)
    .returning('*');

  return inserted;
}

// ============================================================================
// Test Data Cleanup
// ============================================================================

/**
 * Clean up all test notifications for a user
 */
export async function cleanupNotifications(
  db: Knex,
  tenant: string,
  userId?: string
) {
  let query = db('internal_notifications').where({ tenant });

  if (userId) {
    query = query.andWhere({ user_id: userId });
  }

  await query.delete();
}

/**
 * Clean up all test preferences for a user
 */
export async function cleanupPreferences(
  db: Knex,
  tenant: string,
  userId?: string
) {
  let query = db('user_internal_notification_preferences').where({ tenant });

  if (userId) {
    query = query.andWhere({ user_id: userId });
  }

  await query.delete();
}

/**
 * Clean up all test users for a tenant
 */
export async function cleanupUsers(
  db: Knex,
  tenant: string
) {
  await db('users').where({ tenant }).delete();
}

/**
 * Clean up all test tickets for a tenant
 */
export async function cleanupTickets(
  db: Knex,
  tenant: string
) {
  await db('tickets').where({ tenant }).delete();
}

/**
 * Clean up all test comments for a tenant
 */
export async function cleanupComments(
  db: Knex,
  tenant: string
) {
  await db('comments').where({ tenant }).delete();
}

/**
 * Clean up all test data for a tenant
 */
export async function cleanupAllTestData(
  db: Knex,
  tenant: string
) {
  // Order matters due to foreign keys
  await cleanupNotifications(db, tenant);
  await cleanupPreferences(db, tenant);
  await cleanupComments(db, tenant);
  await cleanupTickets(db, tenant);
  await cleanupUsers(db, tenant);
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that a notification exists with specific properties
 */
export async function assertNotificationExists(
  db: Knex,
  tenant: string,
  userId: string,
  expectedProperties: {
    template_name?: string;
    category?: string;
    link?: string;
    is_read?: boolean;
  }
) {
  let query = db('internal_notifications')
    .where({ tenant, user_id: userId })
    .whereNull('deleted_at');

  if (expectedProperties.template_name) {
    query = query.andWhere({ template_name: expectedProperties.template_name });
  }

  if (expectedProperties.category) {
    query = query.andWhere({ category: expectedProperties.category });
  }

  if (expectedProperties.link) {
    query = query.andWhere({ link: expectedProperties.link });
  }

  if (expectedProperties.is_read !== undefined) {
    query = query.andWhere({ is_read: expectedProperties.is_read });
  }

  const notifications = await query;

  return notifications.length > 0;
}

/**
 * Get notification count for a user
 */
export async function getNotificationCount(
  db: Knex,
  tenant: string,
  userId: string,
  filters: {
    is_read?: boolean;
    category?: string;
  } = {}
) {
  let query = db('internal_notifications')
    .where({ tenant, user_id: userId })
    .whereNull('deleted_at');

  if (filters.is_read !== undefined) {
    query = query.andWhere({ is_read: filters.is_read });
  }

  if (filters.category) {
    query = query.andWhere({ category: filters.category });
  }

  const [{ count }] = await query.count('* as count');

  return Number(count);
}

/**
 * Wait for async event processing
 */
export async function waitForEventProcessing(ms: number = 100): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Mock Event Helpers
// ============================================================================

/**
 * Create a mock ticket event
 */
export function createMockTicketEvent(
  eventType: 'TICKET_CREATED' | 'TICKET_ASSIGNED' | 'TICKET_UPDATED' | 'TICKET_CLOSED' | 'TICKET_COMMENT_ADDED',
  payload: {
    tenantId: string;
    ticketId: string;
    userId: string;
    changes?: Record<string, any>;
    comment?: {
      id: string;
      content: string;
      author: string;
      isInternal?: boolean;
    };
  }
) {
  return {
    id: uuidv4(),
    eventType,
    timestamp: new Date().toISOString(),
    payload
  };
}

/**
 * Create a mock project event
 */
export function createMockProjectEvent(
  eventType: 'PROJECT_CREATED' | 'PROJECT_ASSIGNED' | 'PROJECT_TASK_ASSIGNED',
  payload: {
    tenantId: string;
    projectId: string;
    userId: string;
    taskId?: string;
    assignedTo?: string;
  }
) {
  return {
    id: uuidv4(),
    eventType,
    timestamp: new Date().toISOString(),
    payload
  };
}

// ============================================================================
// Test Data Builders (Fluent API)
// ============================================================================

/**
 * Fluent builder for test notifications
 */
export class NotificationBuilder {
  private notification: any = {
    type: 'info',
    is_read: false,
    delivery_status: 'pending',
    delivery_attempts: 0
  };

  constructor(
    private db: Knex,
    private tenant: string,
    private userId: string
  ) {
    this.notification.tenant = tenant;
    this.notification.user_id = userId;
  }

  withTemplate(templateName: string) {
    this.notification.template_name = templateName;
    return this;
  }

  withTitle(title: string) {
    this.notification.title = title;
    return this;
  }

  withMessage(message: string) {
    this.notification.message = message;
    return this;
  }

  withCategory(category: string) {
    this.notification.category = category;
    return this;
  }

  withLink(link: string) {
    this.notification.link = link;
    return this;
  }

  asRead() {
    this.notification.is_read = true;
    this.notification.read_at = new Date();
    return this;
  }

  withMetadata(metadata: Record<string, any>) {
    this.notification.metadata = JSON.stringify(metadata);
    return this;
  }

  async create() {
    const [inserted] = await this.db('internal_notifications')
      .insert(this.notification)
      .returning('*');
    return inserted;
  }
}

/**
 * Create a notification builder
 */
export function buildNotification(db: Knex, tenant: string, userId: string) {
  return new NotificationBuilder(db, tenant, userId);
}

// ============================================================================
// Export all helpers
// ============================================================================

export default {
  // Factories
  createTestUser,
  createTestTicket,
  createTestComment,
  createTestTemplate,
  createTestNotification,
  createTestPreference,

  // Cleanup
  cleanupNotifications,
  cleanupPreferences,
  cleanupUsers,
  cleanupTickets,
  cleanupComments,
  cleanupAllTestData,

  // Assertions
  assertNotificationExists,
  getNotificationCount,
  waitForEventProcessing,

  // Mocks
  createMockTicketEvent,
  createMockProjectEvent,

  // Builders
  buildNotification
};
