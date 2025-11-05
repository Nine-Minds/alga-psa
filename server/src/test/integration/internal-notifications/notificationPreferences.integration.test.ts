import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import {
  createTestUser,
  cleanupNotifications,
  cleanupPreferences
} from '../../helpers/notificationTestHelpers';

let testDb: Knex;
let testTenantId: string;
let testUserId: string;
let testCategoryId: number | undefined;
let testSubtypeId: number | undefined;
let testTemplateName: string;

vi.mock('server/src/lib/realtime/internalNotificationBroadcaster', () => ({
  broadcastNotification: vi.fn().mockResolvedValue(undefined),
  broadcastNotificationRead: vi.fn().mockResolvedValue(undefined),
  broadcastAllNotificationsRead: vi.fn().mockResolvedValue(undefined),
  broadcastUnreadCount: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({
    knex: testDb,
    tenant: testTenantId
  })),
  getConnection: vi.fn(async () => testDb)
}));

import {
  broadcastNotification
} from 'server/src/lib/realtime/internalNotificationBroadcaster';

let createNotificationFromTemplateAction: typeof import('server/src/lib/actions/internal-notification-actions/internalNotificationActions')['createNotificationFromTemplateAction'];

function parseMetadata(metadata: unknown) {
  if (!metadata) return null;
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  return metadata as Record<string, unknown>;
}

describe('Internal Notification Preferences (integration)', () => {
  beforeAll(async () => {
    const actions = await import('server/src/lib/actions/internal-notification-actions/internalNotificationActions');
    createNotificationFromTemplateAction = actions.createNotificationFromTemplateAction;

    testDb = await createTestDbConnection();
    testTenantId = uuidv4();
    testTemplateName = `integration-template-${Date.now()}`;

    // Seed tenant
    await testDb('tenants').insert({
      tenant: testTenantId,
      client_name: 'Integration Tenant',
      email: 'integration@example.com',
      created_at: new Date(),
      updated_at: new Date()
    });

    // Seed user (client user to exercise locale preferences)
    const user = await createTestUser(testDb, testTenantId, { user_type: 'client' });
    testUserId = user.user_id;

    // Seed custom category
    const categoryRows = await testDb('internal_notification_categories')
      .insert({
        name: `integration-category-${uuidv4()}`,
        description: 'Integration category',
        is_enabled: true,
        is_default_enabled: true,
        available_for_client_portal: true
      })
      .returning('internal_notification_category_id');

    const categoryRow = Array.isArray(categoryRows) ? categoryRows[0] : categoryRows;
    const categoryValue =
      typeof categoryRow === 'number'
        ? categoryRow
        : categoryRow.internal_notification_category_id;
    testCategoryId = Number(categoryValue);

    // Seed custom subtype
    const subtypeRows = await testDb('internal_notification_subtypes')
      .insert({
        internal_category_id: testCategoryId,
        name: `integration-subtype-${uuidv4()}`,
        description: 'Integration subtype',
        is_enabled: true,
        is_default_enabled: true,
        available_for_client_portal: true
      })
      .returning('internal_notification_subtype_id');

    const subtypeRow = Array.isArray(subtypeRows) ? subtypeRows[0] : subtypeRows;
    const subtypeValue =
      typeof subtypeRow === 'number'
        ? subtypeRow
        : subtypeRow.internal_notification_subtype_id;
    testSubtypeId = Number(subtypeValue);

    // Seed templates (English + Spanish)
    await testDb('internal_notification_templates').insert([
      {
        name: testTemplateName,
        language_code: 'en',
        title: 'Ticket {{ticketId}} assigned',
        message: 'Ticket {{ticketTitle}} assigned',
        subtype_id: testSubtypeId
      },
      {
        name: testTemplateName,
        language_code: 'es',
        title: 'Ticket {{ticketId}} asignado',
        message: 'Ticket {{ticketTitle}} asignado',
        subtype_id: testSubtypeId
      }
    ]);
  });

  beforeEach(async () => {
    await cleanupNotifications(testDb, testTenantId);
    await cleanupPreferences(testDb, testTenantId, testUserId);
    await testDb('user_preferences').where({ tenant: testTenantId, user_id: testUserId }).delete();

    if (typeof testCategoryId !== 'number' || typeof testSubtypeId !== 'number') {
      throw new Error('Internal notification taxonomy not initialized for tests');
    }

    await testDb('internal_notification_categories')
      .where({ internal_notification_category_id: testCategoryId })
      .update({ is_enabled: true, is_default_enabled: true });

    await testDb('internal_notification_subtypes')
      .where({ internal_notification_subtype_id: testSubtypeId })
      .update({ is_enabled: true, is_default_enabled: true });

    vi.mocked(broadcastNotification).mockClear();
  });

  afterAll(async () => {
    await cleanupNotifications(testDb, testTenantId);
    await cleanupPreferences(testDb, testTenantId);

    await testDb('user_preferences').where({ tenant: testTenantId }).delete();
    await testDb('internal_notification_templates').where({ name: testTemplateName }).delete();
    if (typeof testSubtypeId === 'number') {
      await testDb('internal_notification_subtypes').where({ internal_notification_subtype_id: testSubtypeId }).delete();
    }
    if (typeof testCategoryId === 'number') {
      await testDb('internal_notification_categories').where({ internal_notification_category_id: testCategoryId }).delete();
    }
    await testDb('users').where({ tenant: testTenantId }).delete();
    await testDb('tenants').where({ tenant: testTenantId }).delete();
    await testDb.destroy();
  });

  it('creates a notification when preferences allow it', async () => {
    const result = await createNotificationFromTemplateAction({
      tenant: testTenantId,
      user_id: testUserId,
      template_name: testTemplateName,
      data: {
        ticketId: 'T-100',
        ticketTitle: 'Integration check'
      },
      type: 'info',
      category: 'integration',
      metadata: { scope: 'integration-test' }
    });

    expect(result).toBeTruthy();
    expect(result?.user_id).toBe(testUserId);

    const stored = await testDb('internal_notifications')
      .where({ tenant: testTenantId, user_id: testUserId })
      .first();

    expect(stored).toBeTruthy();
    expect(stored?.title).toBe('Ticket T-100 assigned');
    const metadata = parseMetadata(stored?.metadata);
    expect(metadata?.scope).toBe('integration-test');
    expect(broadcastNotification).toHaveBeenCalledTimes(1);
  });

  it('does not create a notification when category preference is disabled', async () => {
    await testDb('user_internal_notification_preferences').insert({
      tenant: testTenantId,
      user_id: testUserId,
      category_id: testCategoryId,
      subtype_id: null,
      is_enabled: false
    });

    const result = await createNotificationFromTemplateAction({
      tenant: testTenantId,
      user_id: testUserId,
      template_name: testTemplateName,
      data: {
        ticketId: 'T-101',
        ticketTitle: 'Preference disabled'
      },
      type: 'info',
      category: 'integration'
    });

    expect(result).toBeNull();

    const stored = await testDb('internal_notifications')
      .where({ tenant: testTenantId, user_id: testUserId })
      .first();

    expect(stored).toBeUndefined();
    expect(broadcastNotification).not.toHaveBeenCalled();
  });

  it('allows subtype preference to override disabled category', async () => {
    await testDb('user_internal_notification_preferences').insert([
      {
        tenant: testTenantId,
        user_id: testUserId,
        category_id: testCategoryId,
        subtype_id: null,
        is_enabled: false
      },
      {
        tenant: testTenantId,
        user_id: testUserId,
        category_id: null,
        subtype_id: testSubtypeId,
        is_enabled: true
      }
    ]);

    const result = await createNotificationFromTemplateAction({
      tenant: testTenantId,
      user_id: testUserId,
      template_name: testTemplateName,
      data: {
        ticketId: 'T-102',
        ticketTitle: 'Subtype override'
      },
      type: 'info',
      category: 'integration'
    });

    expect(result).toBeTruthy();

    const stored = await testDb('internal_notifications')
      .where({ tenant: testTenantId, user_id: testUserId })
      .first();

    expect(stored).toBeTruthy();
    expect(broadcastNotification).toHaveBeenCalledTimes(1);
  });

  it('renders notification using user locale when localized template exists', async () => {
    await testDb('user_preferences').insert({
      tenant: testTenantId,
      user_id: testUserId,
      setting_name: 'locale',
      setting_value: JSON.stringify('es'),
      updated_at: new Date()
    });

    const result = await createNotificationFromTemplateAction({
      tenant: testTenantId,
      user_id: testUserId,
      template_name: testTemplateName,
      data: {
        ticketId: 'T-103',
        ticketTitle: 'Servidor caído'
      },
      type: 'info',
      category: 'integration'
    });

    expect(result).toBeTruthy();

    const stored = await testDb('internal_notifications')
      .where({ tenant: testTenantId, user_id: testUserId })
      .first();

    expect(stored?.language_code).toBe('es');
    expect(stored?.title).toBe('Ticket T-103 asignado');
  });

  it('falls back to English template while preserving user locale when translation is missing', async () => {
    await testDb('user_preferences').insert({
      tenant: testTenantId,
      user_id: testUserId,
      setting_name: 'locale',
      setting_value: JSON.stringify('fr'),
      updated_at: new Date()
    });

    const result = await createNotificationFromTemplateAction({
      tenant: testTenantId,
      user_id: testUserId,
      template_name: testTemplateName,
      data: {
        ticketId: 'T-104',
        ticketTitle: 'Fallback check'
      },
      type: 'info',
      category: 'integration'
    });

    expect(result).toBeTruthy();

    const stored = await testDb('internal_notifications')
      .where({ tenant: testTenantId, user_id: testUserId })
      .first();

    expect(stored?.language_code).toBe('fr');
    expect(stored?.title).toBe('Ticket T-104 assigned');
  });
});
