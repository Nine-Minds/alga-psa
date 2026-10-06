import { describe, expect, it } from 'vitest';
import {
  CommentEmailRecipientsError,
  MAX_COMMENT_EMAIL_RECIPIENTS,
  normalizeCommentEmailRecipients,
  readCommentEmailRecipients,
} from '../commentEmailRecipients';

const addresses = (count: number, prefix = 'person') =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}@example.com`);

describe('normalizeCommentEmailRecipients', () => {
  it('T001: trims whitespace and dedupes case-insensitively within cc, keeping the first display casing', () => {
    expect(
      normalizeCommentEmailRecipients({
        cc: ['  Jane.Doe@Example.com ', 'jane.doe@example.com', 'other@example.com'],
      })
    ).toEqual({
      cc: [{ email: 'Jane.Doe@Example.com' }, { email: 'other@example.com' }],
      bcc: [],
    });
  });

  it('T002: an address present in both cc and bcc is kept in cc only', () => {
    expect(
      normalizeCommentEmailRecipients({
        cc: ['shared@example.com'],
        bcc: ['SHARED@example.com', 'boss@example.com'],
      })
    ).toEqual({
      cc: [{ email: 'shared@example.com' }],
      bcc: [{ email: 'boss@example.com' }],
    });
  });

  it('T003: an invalid address throws a validation error naming the field and value', () => {
    try {
      normalizeCommentEmailRecipients({ bcc: ['not-an-email'] });
      throw new Error('expected a validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(CommentEmailRecipientsError);
      const typed = error as CommentEmailRecipientsError;
      expect(typed.field).toBe('bcc');
      expect(typed.value).toBe('not-an-email');
      expect(typed.message).toContain('not-an-email');
    }
  });

  it('T004: rejects 21 combined recipients and accepts 20', () => {
    const twenty = normalizeCommentEmailRecipients({
      cc: addresses(10, 'cc'),
      bcc: addresses(10, 'bcc'),
    });
    expect(twenty?.cc).toHaveLength(10);
    expect(twenty?.bcc).toHaveLength(10);
    expect(MAX_COMMENT_EMAIL_RECIPIENTS).toBe(20);

    expect(() =>
      normalizeCommentEmailRecipients({ cc: addresses(11, 'cc'), bcc: addresses(10, 'bcc') })
    ).toThrow(CommentEmailRecipientsError);
  });

  it('T005: non-empty cc/bcc with isInternal=true throws; empty lists are accepted', () => {
    expect(() =>
      normalizeCommentEmailRecipients({ cc: ['someone@example.com'], isInternal: true })
    ).toThrow(/internal note/i);
    expect(normalizeCommentEmailRecipients({ cc: [], bcc: [], isInternal: true })).toBeNull();
  });

  it('T006: undefined/empty cc and bcc return null so no metadata key is written', () => {
    expect(normalizeCommentEmailRecipients({})).toBeNull();
    expect(normalizeCommentEmailRecipients({ cc: [], bcc: [] })).toBeNull();
    expect(normalizeCommentEmailRecipients({ cc: ['   '], bcc: [] })).toBeNull();
  });
});

describe('readCommentEmailRecipients', () => {
  it('reads from an object and from a jsonb string, and returns null when absent', () => {
    const stored = { email_recipients: { cc: [{ email: 'a@example.com', name: 'A' }], bcc: [] } };
    expect(readCommentEmailRecipients(stored)).toEqual({
      cc: [{ email: 'a@example.com', name: 'A' }],
      bcc: [],
    });
    expect(readCommentEmailRecipients(JSON.stringify(stored))).toEqual({
      cc: [{ email: 'a@example.com', name: 'A' }],
      bcc: [],
    });
    expect(readCommentEmailRecipients(null)).toBeNull();
    expect(readCommentEmailRecipients({ closes_ticket: true })).toBeNull();
    expect(readCommentEmailRecipients({ email_recipients: { cc: [], bcc: [] } })).toBeNull();
  });
});
