import { describe, expect, it } from 'vitest';
import { deriveReplyIdentity } from '../inboundEmailMimeHelpers';

describe('deriveReplyIdentity', () => {
  it('finds headers under exact-case and lower-case names', () => {
    for (const headers of [
      { 'In-Reply-To': '<a@x>', References: '<r@x> <a@x>' },
      { 'in-reply-to': '<a@x>', references: '<r@x> <a@x>' },
    ]) {
      expect(deriveReplyIdentity({ headers })).toEqual({
        inReplyTo: '<a@x>',
        references: ['<r@x>', '<a@x>'],
        threadId: '<r@x>',
      });
    }
  });

  it('splits a folded References header with tabs, newlines and repeated spaces', () => {
    const out = deriveReplyIdentity({
      headers: { References: '<one@x>\r\n\t<two@x>   <three@x>\n <four@x>' },
    });
    expect(out.references).toEqual(['<one@x>', '<two@x>', '<three@x>', '<four@x>']);
  });

  it('accepts array values', () => {
    expect(deriveReplyIdentity({ headers: { references: ['<a@x>', '<b@x>'] } }).references).toEqual(['<a@x>', '<b@x>']);
  });

  it('returns undefined fields when headers are absent', () => {
    expect(deriveReplyIdentity({ headers: {} })).toEqual({
      inReplyTo: undefined,
      references: undefined,
      threadId: undefined,
    });
    expect(deriveReplyIdentity({})).toEqual({ inReplyTo: undefined, references: undefined, threadId: undefined });
  });

  it('prefers the provider conversation id for threadId', () => {
    expect(
      deriveReplyIdentity({ headers: { References: '<r@x>' }, conversationId: 'conv-1' }).threadId
    ).toBe('conv-1');
    expect(deriveReplyIdentity({ headers: {}, conversationId: 'conv-1' }).threadId).toBe('conv-1');
  });

  it('falls back to In-Reply-To when there are no references', () => {
    expect(deriveReplyIdentity({ headers: { 'In-Reply-To': '<a@x>' } }).threadId).toBe('<a@x>');
  });
});
