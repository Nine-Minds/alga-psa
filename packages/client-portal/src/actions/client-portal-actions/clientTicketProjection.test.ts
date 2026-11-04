import { describe, expect, it } from 'vitest';
import { projectClientTicketDetail, projectClientTicketList } from './clientTicketProjection';

describe('client ticket response allowlists', () => {
  const description = { type: 'doc', content: [{ type: 'paragraph', text: 'Customer description' }] };
  const row = {
    ticket_id: 'ticket-1', ticket_number: 'T-1', title: 'Customer ticket',
    attributes: {
      description,
      watch_list: [{ email: 'watcher@example.test', entity_id: 'watcher-id', source: 'internal-rule', added_at: '2026-01-01' }],
      future_private_attribute: 'private-attribute',
    },
    email_metadata: {
      providerId: 'provider-secret', messageId: 'message-secret', threadId: 'thread-secret',
      authentication: 'auth-secret', matchedContact: 'matching-secret', ruleId: 'rule-secret',
    },
    assigned_to: 'staff-id',
    additional_agents: [{ name: 'Avery Agent', role: 'staff', avatar_url: '/avatar', email: 'staff@example.test', user_id: 'staff-id' }],
    future_private_column: 'private-column',
    ticket_origin: 'inbound_email', has_original_email: true,
  };

  it.each([
    ['list', projectClientTicketList],
    ['detail', projectClientTicketDetail],
  ] as const)('excludes private ticket and agent fields from the serialized %s response', (_name, project) => {
    const response = JSON.parse(JSON.stringify(project(row)));
    expect(response).toMatchObject({ ticket_id: 'ticket-1', title: 'Customer ticket' });
    expect(response.additional_agents).toEqual([{ name: 'Avery Agent', role: 'staff', avatar_url: '/avatar' }]);
    for (const field of ['email_metadata', 'assigned_to', 'future_private_column']) {
      expect(response).not.toHaveProperty(field);
    }
    const serialized = JSON.stringify(response);
    for (const secret of ['watcher@example.test', 'watcher-id', 'internal-rule', 'private-attribute', 'provider-secret', 'message-secret', 'thread-secret', 'auth-secret', 'matching-secret', 'rule-secret', 'staff@example.test', 'staff-id', 'private-column']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('omits attributes from list responses entirely', () => {
    expect(projectClientTicketList(row)).not.toHaveProperty('attributes');
  });

  it('preserves only the supported description and derived email flags in details', () => {
    expect(projectClientTicketDetail(row)).toMatchObject({
      attributes: { description }, ticket_origin: 'inbound_email', has_original_email: true,
    });
    expect(projectClientTicketDetail(row).attributes).toEqual({ description });
  });

  it.each([null, undefined, 'invalid'])('handles absent or malformed attributes: %s', (attributes) => {
    expect(projectClientTicketDetail({ ...row, attributes, has_original_email: false })).toMatchObject({
      attributes: null, has_original_email: false,
    });
  });
});
