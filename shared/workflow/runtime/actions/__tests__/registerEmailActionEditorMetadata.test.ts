import { beforeAll, describe, expect, it } from 'vitest';

import { zodToWorkflowJsonSchema } from '../../jsonSchemaMetadata';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerEmailActions } from '../businessOperations/email';

describe('email.send editor metadata', () => {
  beforeAll(() => {
    if (!getActionRegistryV2().get('email.send', 1)) {
      registerEmailActions();
    }
  });

  it('gives the HTML and plain-text bodies a multi-line editor and keeps their descriptions', () => {
    const action = getActionRegistryV2().get('email.send', 1);
    if (!action) throw new Error('Expected email.send to be registered');
    const properties = (zodToWorkflowJsonSchema(action.inputSchema) as {
      properties: Record<string, Record<string, unknown>>;
    }).properties;

    for (const key of ['html', 'text']) {
      expect(properties[key]['x-workflow-editor']).toMatchObject({ kind: 'text', inline: { mode: 'textarea' } });
      expect(properties[key].description).toMatch(/body/);
    }
    expect(properties.subject['x-workflow-editor']).toBeUndefined();
  });

  const getAction = () => {
    const action = getActionRegistryV2().get('email.send', 1);
    if (!action) throw new Error('Expected email.send to be registered');
    return action;
  };
  const getSchema = () =>
    zodToWorkflowJsonSchema(getAction().inputSchema) as {
      properties: Record<string, Record<string, any>>;
      required?: string[];
    } & Record<string, any>;

  it('offers the user, ticket and policy inputs with their editor metadata', () => {
    const schema = getSchema();
    const properties = schema.properties;

    expect(properties.users['x-workflow-editor']).toMatchObject({ kind: 'custom', custom: { component: 'email-user-recipients' } });
    expect(properties.ticket_id['x-workflow-picker-kind']).toBe('ticket');
    expect(properties.ticket_assignees['x-workflow-option-labels']).toEqual({
      assigned: 'Assigned technician only',
      assigned_and_additional: 'Assigned technician and additional resources',
    });
    expect(properties.users_as['x-workflow-option-labels']).toEqual({ to: 'To', cc: 'Cc', bcc: 'Bcc' });
    expect(properties.on_no_recipients['x-workflow-option-labels']).toMatchObject({ error: expect.any(String), skip: expect.any(String) });
    expect(properties.on_no_recipients['x-workflow-failure-policy']).toEqual({ failValue: 'error' });
    expect(schema['x-workflow-require-one-of']).toEqual(['to', 'users', 'ticket_id']);
    expect(schema.required ?? []).not.toContain('to');
  });

  it('keeps the designer field order from the plan', () => {
    expect(Object.keys(getSchema().properties)).toEqual([
      'to', 'users', 'ticket_id', 'ticket_assignees', 'users_as', 'cc', 'bcc', 'from', 'sender_id', 'mail_class',
      'subject', 'html', 'text', 'template_data', 'attachment_file_ids', 'provider_id', 'on_no_recipients', 'idempotency_key',
    ]);
  });

  it('parses a legacy literal-only input to the same value as before', () => {
    const legacy = { to: [{ email: 'a@example.com', name: 'A' }], subject: 'Hi', text: 'Body' };
    expect(getAction().inputSchema.parse(legacy)).toEqual({
      ...legacy,
      mail_class: 'general',
      ticket_assignees: 'assigned_and_additional',
      users_as: 'to',
      on_no_recipients: 'error',
    });
  });

  it('accepts users or a ticket alone and rejects input with no recipient source', () => {
    const schema = getAction().inputSchema;
    expect(schema.safeParse({ subject: 'Hi', users: { role_names: ['Technician'] } }).success).toBe(true);
    expect(schema.safeParse({ subject: 'Hi', ticket_id: '8d4a1f0e-1a2b-4c3d-8e9f-0123456789ab' }).success).toBe(true);
    expect(schema.safeParse({ subject: 'Hi' }).success).toBe(false);
    expect(schema.safeParse({ subject: 'Hi', to: [], users: {} }).success).toBe(false);
  });
});
