import { beforeAll, describe, expect, it } from 'vitest';

import { zodToWorkflowJsonSchema } from '../../jsonSchemaMetadata';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerNotificationActions } from '../businessOperations/notifications';

describe('notification workflow picker metadata', () => {
  beforeAll(() => {
    if (!getActionRegistryV2().get('notifications.send_in_app', 1)) {
      registerNotificationActions();
    }
  });

  it('offers the user picker for in-app notification recipients', () => {
    const action = getActionRegistryV2().get('notifications.send_in_app', 1);
    if (!action) throw new Error('Expected notifications.send_in_app to be registered');

    const schema = zodToWorkflowJsonSchema(action.inputSchema);
    const recipients = (schema.properties as Record<string, { properties?: Record<string, Record<string, unknown>> }>).recipients;

    expect(recipients.properties?.user_ids).toMatchObject({
      type: 'array',
      'x-workflow-picker-kind': 'user',
      'x-workflow-picker-fixed-value-hint': 'Search users',
    });
    expect(recipients.properties?.role_ids).toMatchObject({
      type: 'array',
      'x-workflow-picker-kind': 'role',
      'x-workflow-picker-fixed-value-hint': 'Search roles',
    });
  });

  it('explains the link as where opening the notification takes the user', () => {
    const action = getActionRegistryV2().get('notifications.send_in_app', 1);
    if (!action) throw new Error('Expected notifications.send_in_app to be registered');
    const schema = zodToWorkflowJsonSchema(action.inputSchema);
    const link = (schema.properties as Record<string, { description?: string }>).link;
    expect(link.description).toMatch(/^Opening the notification takes the user here/);
  });
});

