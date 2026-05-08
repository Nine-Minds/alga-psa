import { describe, expect, it } from 'vitest';

import { webhookEventTypeSchema } from '../webhookSchemas';

describe('webhookEventTypeSchema', () => {
  it('accepts ticket.comment.added', () => {
    expect(webhookEventTypeSchema.safeParse('ticket.comment.added').success).toBe(true);
  });
});
