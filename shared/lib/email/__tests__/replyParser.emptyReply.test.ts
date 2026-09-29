import { describe, expect, it } from 'vitest';
import { parseEmailReply } from '../replyParser';

const token = '[ALGA-REPLY-TOKEN test-token ticketId=ticket-1 commentId=comment-1]';
const notification = `${token}\n--- Please reply above this line ---\nNew comment added\nA new comment has been added to your ticket.`;

describe('empty Alga replies', () => {
  it.each([notification, token])('does not restore notification or token text after extraction: %s', (text) => {
    const result = parseEmailReply({ text });
    expect(result.tokens?.conversationToken).toBe('test-token');
    expect(result.sanitizedText).toBe('');
  });

  it('preserves a genuine reply above the notification', () => {
    expect(parseEmailReply({ text: `The restart worked.\n${notification}` }).sanitizedText)
      .toBe('The restart worked.');
  });

  it('preserves the fallback for ambiguous ordinary email without an Alga token', () => {
    expect(parseEmailReply({ text: 'Thanks' }).sanitizedText).toBe('Thanks');
  });
});
