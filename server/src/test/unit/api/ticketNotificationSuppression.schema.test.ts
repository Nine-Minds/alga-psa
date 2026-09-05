import { describe, expect, it } from 'vitest';

import {
  addTicketAgentSchema,
  assignTicketTeamSchema,
  createTicketCommentSchema,
  updateTicketAssignmentSchema,
  updateTicketSchema,
  updateTicketStatusSchema,
} from '../../../lib/api/schemas/ticket';

const id = '00000000-0000-4000-8000-000000000001';

const cases = [
  ['ticket update', updateTicketSchema, { title: 'Silent title' }],
  ['status update', updateTicketStatusSchema, { status_id: id }],
  ['assignment update', updateTicketAssignmentSchema, { assigned_to: id }],
  ['comment create', createTicketCommentSchema, { comment_text: 'Silent comment' }],
  ['additional agent assignment', addTicketAgentSchema, { user_id: id }],
  ['team assignment', assignTicketTeamSchema, { team_id: id }],
] as const;

describe('ticket REST notification suppression schemas', () => {
  it.each(cases)('accepts both silent-update flags for %s', (_name, schema, payload) => {
    const result = schema.parse({
      ...payload,
      suppressContactNotifications: true,
      suppressInternalNotifications: true,
    });

    expect(result).toEqual(expect.objectContaining({
      suppressContactNotifications: true,
      suppressInternalNotifications: true,
    }));
  });

  it.each(cases)('rejects internal-only suppression for %s', (_name, schema, payload) => {
    const result = schema.safeParse({
      ...payload,
      suppressInternalNotifications: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: ['suppressInternalNotifications'],
          message: 'suppressInternalNotifications requires suppressContactNotifications',
        }),
      ]));
    }
  });
});
