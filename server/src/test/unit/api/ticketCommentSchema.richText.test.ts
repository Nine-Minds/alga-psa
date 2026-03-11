import { describe, expect, it } from 'vitest';
import { createTicketCommentSchema } from '../../../lib/api/schemas/ticket';

describe('createTicketCommentSchema rich text length handling', () => {
  it('accepts formatted rich text when visible comment length is within the limit', () => {
    const visibleText = 'A'.repeat(4_900);
    const payload = JSON.stringify([
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: visibleText,
            styles: {
              bold: true,
              italic: true,
              underline: true,
            },
          },
        ],
      },
    ]);

    expect(() => createTicketCommentSchema.parse({
      comment_text: payload,
      is_internal: false,
    })).not.toThrow();
  });

  it('rejects rich text when the visible comment length exceeds the limit', () => {
    const payload = JSON.stringify([
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'A'.repeat(5_001),
            styles: {},
          },
        ],
      },
    ]);

    expect(() => createTicketCommentSchema.parse({
      comment_text: payload,
      is_internal: false,
    })).toThrow(/max 5000 characters/i);
  });
});
