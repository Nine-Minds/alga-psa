import { beforeAll, describe, expect, it } from 'vitest';

import { zodToWorkflowJsonSchema } from '../../jsonSchemaMetadata';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerTicketActions } from '../businessOperations/tickets';

describe('tickets.add_comment Cc/Bcc inputs', () => {
  beforeAll(() => {
    if (!getActionRegistryV2().get('tickets.add_comment', 1)) {
      registerTicketActions();
    }
  });

  it('T046: cc/bcc are optional email-recipient lists rendered with the designer recipients editor', () => {
    const action = getActionRegistryV2().get('tickets.add_comment', 1);
    expect(action).toBeDefined();
    if (!action) {
      throw new Error('Expected tickets.add_comment to be registered');
    }

    const schema = zodToWorkflowJsonSchema(action.inputSchema) as {
      properties: Record<string, Record<string, unknown>>;
      required?: string[];
    };

    for (const field of ['cc', 'bcc'] as const) {
      const property = schema.properties[field];
      expect(property, field).toBeDefined();
      expect(property['x-workflow-editor']).toEqual({
        kind: 'custom',
        custom: { component: 'email-recipients' },
      });
      expect(schema.required ?? []).not.toContain(field);
    }

    // A literal list of addresses parses; so does an empty list.
    expect(action.inputSchema.safeParse({
      ticket_id: '11111111-1111-4111-8111-111111111111',
      body: 'Looping in the vendor',
      visibility: 'public',
      cc: [{ email: 'vendor@acme.com', name: 'Vendor' }],
      bcc: [{ email: 'boss@msp.test' }],
    }).success).toBe(true);
    expect(action.inputSchema.safeParse({
      ticket_id: '11111111-1111-4111-8111-111111111111',
      body: 'No copies',
      visibility: 'public',
    }).success).toBe(true);
    // A malformed address is rejected before the handler runs.
    expect(action.inputSchema.safeParse({
      ticket_id: '11111111-1111-4111-8111-111111111111',
      body: 'Bad address',
      visibility: 'public',
      cc: [{ email: 'not-an-email' }],
    }).success).toBe(false);
  });
});
