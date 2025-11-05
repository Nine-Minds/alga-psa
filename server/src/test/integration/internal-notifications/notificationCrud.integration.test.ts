import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import {
  createTestUser,
  cleanupNotifications,
  cleanupPreferences
} from '../../helpers/notificationTestHelpers';

import type { InternalNotification } from 'server/src/lib/models/internalNotification';

vi.mock('server/src/lib/realtime/internalNotificationBroadcaster', () => ({
  broadcastNotification: vi.fn().mockResolvedValue(undefined),
  broadcastNotificationRead: vi.fn().mockResolvedValue(undefined),
  broadcastAllNotificationsRead: vi.fn().mockResolvedValue(undefined),
  broadcastUnreadCount: vi.fn().mockResolvedValue(undefined)
}));

let testDb: Knex;
let testTenantId: string;
let testUserId: string;
let categoryId: number;
let subtypeId: number;
let templateName: string;

const createTenantKnexMock = vi.fn(async () => ({ knex: testDb, tenant: testTenantId }));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: createTenantKnexMock
}));

import {
  broadcastNotification,
  broadcastNotificationRead,
  broadcastAllNotificationsRead
} from 'server/src/lib/realtime/internalNotificationBroadcaster';

let createNotificationFromTemplateAction: typeof import('server/src/lib/actions/internal-notification-actions/internalNotificationActions')['createNotificationFromTemplateAction'];
let getNotificationsAction: typeof import('server/src/lib/actions/internal-notification-actions/internalNotificationActions')['getNotificationsAction'];
let getUnreadCountAction: typeof import('server/src/lib/actions/internal-notification-actions/internalNotificationActions')['getUnreadCountAction'];
let markAsReadAction: typeof import('server/src/lib/actions/internal-notification-actions/internalNotificationActions')['markAsReadAction'];
let markAllAsReadAction: typeof import('server/src/lib/actions/internal-notification-actions/internalNotificationActions')['markAllAsReadAction'];
let deleteNotificationAction: typeof import('server/src/lib/actions/internal-notification-actions/internalNotificationActions')['deleteNotificationAction'];

describe('Internal notification CRUD (integration)', () => {
  beforeAll(async () => {
    const actions = await import('server/src/lib/actions/internal-notification-actions/internalNotificationActions');
    createNotificationFromTemplateAction = actions.createNotificationFromTemplateAction;
    getNotificationsAction = actions.getNotificationsAction;
    getUnreadCountAction = actions.getUnreadCountAction;
    markAsReadAction = actions.markAsReadAction;
    markAllAsReadAction = actions.markAllAsReadAction;
    deleteNotificationAction = actions.deleteNotificationAction;

    testDb = await createTestDbConnection();
    testTenantId = uuidv4();
    templateName = `crud-template-${Date.now()}`;

    await testDb('tenants').insert({
      tenant: testTenantId,
      client_name: 'CRUD Tenant',
      email: 'crud@example.com',
      created_at: new Date(),
      updated_at: new Date()
    });

    const user = await createTestUser(testDb, testTenantId, { user_type: 'client' });
    testUserId = user.user_id;

    const categoryRows = await testDb('internal_notification_categories')
      .insert({
        name: `crud-category-${uuidv4()}`,
        description: 'CRUD test category',
        is_enabled: true,
        is_default_enabled: true,
        available_for_client_portal: true
      })
      .returning('internal_notification_category_id');
    const categoryRow = Array.isArray(categoryRows) ? categoryRows[0] : categoryRows;
    categoryId = typeof categoryRow === 'number' ? categoryRow : categoryRow.internal_notification_category_id;

    const subtypeRows = await testDb('internal_notification_subtypes')
      .insert({
        internal_category_id: categoryId,
        name: `crud-subtype-${uuidv4()}`,
        description: 'CRUD subtype',
        is_enabled: true,
        is_default_enabled: true,
        available_for_client_portal: true
      })
      .returning('internal_notification_subtype_id');
    const subtypeRow = Array.isArray(subtypeRows) ? subtypeRows[0] : subtypeRows;
    subtypeId = typeof subtypeRow === 'number' ? subtypeRow : subtypeRow.internal_notification_subtype_id;

    await testDb('internal_notification_templates').insert([
      {
        name: templateName,
        language_code: 'en',
        title: 'Ticket {{ticketId}} assigned',
        message: 'Ticket {{ticketTitle}} assigned',
        subtype_id: subtypeId
      },
      {
        name: templateName,
        language_code: 'es',
        title: 'Ticket {{ticketId}} asignado',
        message: 'Ticket {{ticketTitle}} asignado',
        subtype_id: subtypeId
      }
    ]);
  });

  beforeEach(async () => {
    createTenantKnexMock.mockClear();
    await cleanupNotifications(testDb, testTenantId);
    await cleanupPreferences(testDb, testTenantId, testUserId);
    await testDb('user_preferences').where({ tenant: testTenantId, user_id: testUserId }).delete();

    await testDb('internal_notification_categories')
      .where({ internal_notification_category_id: categoryId })
      .update({ is_enabled: true, is_default_enabled: true });

    await testDb('internal_notification_subtypes')
      .where({ internal_notification_subtype_id: subtypeId })
      .update({ is_enabled: true, is_default_enabled: true });

    vi.mocked(broadcastNotification).mockClear();
    vi.mocked(broadcastNotificationRead).mockClear();
    vi.mocked(broadcastAllNotificationsRead).mockClear();
  });

  afterAll(async () => {
    await cleanupNotifications(testDb, testTenantId);
    await cleanupPreferences(testDb, testTenantId);
    await testDb('user_preferences').where({ tenant: testTenantId }).delete();
    await testDb('internal_notification_templates').where({ name: templateName }).delete();
    await testDb('internal_notification_subtypes').where({ internal_notification_subtype_id: subtypeId }).delete();
    await testDb('internal_notification_categories').where({ internal_notification_category_id: categoryId }).delete();
    await testDb('users').where({ tenant: testTenantId }).delete();
    await testDb('tenants').where({ tenant: testTenantId }).delete();
    await testDb.destroy();
  });

  async function createNotification(data: Partial<Record<string, unknown>> = {}) {
    return createNotificationFromTemplateAction({
      tenant: testTenantId,
      user_id: testUserId,
      template_name: templateName,
      data: {
        ticketId: data.ticketId ?? uuidv4(),
        ticketTitle: data.ticketTitle ?? 'Ticket title'
      },
      type: (data.type as any) ?? 'info',
      category: (data.category as string) ?? 'integration',
      metadata: data.metadata ?? undefined,
      link: data.link ?? undefined
    });
  }

  async function fetchNotifications(): Promise<InternalNotification[]> {
    const response = await getNotificationsAction({
      tenant: testTenantId,
      user_id: testUserId
    });
    return response.notifications as InternalNotification[];
  }

  it('creates notification with metadata and default locale', async () => {
    const result = await createNotification({
      ticketId: 'T-500',
      ticketTitle: 'Integration Ticket',
      metadata: { scope: 'crud-test' },
      link: '/tickets/T-500'
    });

    expect(result).toBeTruthy();
    expect(result?.language_code).toBe('en');
    expect(result?.link).toBe('/tickets/T-500');
    expect(broadcastNotification).toHaveBeenCalledTimes(1);

    const stored = (await fetchNotifications())[0];
    expect(stored.title).toBe('Ticket T-500 assigned');
  });

  it('supports locale preference during creation', async () => {
    await testDb('user_preferences').insert({
      tenant: testTenantId,
      user_id: testUserId,
      setting_name: 'locale',
      setting_value: JSON.stringify('es'),
      updated_at: new Date()
    });

    await createNotification({ ticketId: 'T-600', ticketTitle: 'Servidor' });

    const stored = (await fetchNotifications())[0];
    expect(stored.language_code).toBe('es');
    expect(stored.title).toBe('Ticket T-600 asignado');
  });

  it('paginates and filters notifications', async () => {
    const ids: number[] = [];
    for (let index = 0; index < 3; index++) {
      const created = await createNotification({ ticketTitle: `Ticket ${index}` });
      ids.push(created!.internal_notification_id);
    }

    await markAsReadAction(testTenantId, testUserId, ids[0]);

    const page = await getNotificationsAction({
      tenant: testTenantId,
      user_id: testUserId,
      limit: 2,
      offset: 0
    });
    expect(page.notifications).toHaveLength(2);
    expect(page.has_more).toBe(true);

    const unread = await getNotificationsAction({
      tenant: testTenantId,
      user_id: testUserId,
      is_read: false
    });
    expect(unread.notifications.every(n => !n.is_read)).toBe(true);
  });

  it('returns unread counts with category breakdown', async () => {
    await createNotification({ category: 'integration' });
    const readNotification = await createNotification({ category: 'integration' });
    await markAsReadAction(testTenantId, testUserId, readNotification!.internal_notification_id);
    await createNotification({ category: 'other' });

    const counts = await getUnreadCountAction(testTenantId, testUserId, true);
    expect(counts.unread_count).toBe(2);
    expect(counts.by_category?.integration).toBe(1);
    expect(counts.by_category?.other).toBe(1);
  });

  it('marks notification as read with timestamp and broadcast', async () => {
    const notification = await createNotification();
    const updated = await markAsReadAction(testTenantId, testUserId, notification!.internal_notification_id);
    expect(updated.is_read).toBe(true);
    expect(updated.read_at).toBeTruthy();
    expect(broadcastNotificationRead).toHaveBeenCalledWith(testTenantId, testUserId, notification!.internal_notification_id);
  });

  it('marks all notifications as read and soft deletes', async () => {
    const notification = await createNotification();
    const bulk = await markAllAsReadAction(testTenantId, testUserId);
    expect(bulk.updated_count).toBeGreaterThanOrEqual(1);
    expect(broadcastAllNotificationsRead).toHaveBeenCalledTimes(1);

    await deleteNotificationAction(testTenantId, testUserId, notification!.internal_notification_id);
    const remaining = await fetchNotifications();
    expect(remaining.find(n => n.internal_notification_id === notification!.internal_notification_id)).toBeUndefined();
  });
});
