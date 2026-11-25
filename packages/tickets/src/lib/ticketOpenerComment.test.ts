import { describe, expect, it } from 'vitest';
import { getTicketOpenerAttachmentCount, isTicketOpenerComment } from './ticketOpenerComment';

describe('isTicketOpenerComment', () => {
  it('is true for object metadata with opensTicket', () => {
    expect(isTicketOpenerComment({ metadata: { opensTicket: true } })).toBe(true);
  });
  it('is true for metadata stored as a jsonb string', () => {
    expect(isTicketOpenerComment({ metadata: JSON.stringify({ opensTicket: true, email: {} }) })).toBe(true);
  });
  it('is false when missing, false, or not strictly true', () => {
    expect(isTicketOpenerComment({})).toBe(false);
    expect(isTicketOpenerComment(null)).toBe(false);
    expect(isTicketOpenerComment({ metadata: null })).toBe(false);
    expect(isTicketOpenerComment({ metadata: {} })).toBe(false);
    expect(isTicketOpenerComment({ metadata: { opensTicket: false } })).toBe(false);
    expect(isTicketOpenerComment({ metadata: { opensTicket: 'true' } })).toBe(false);
    expect(isTicketOpenerComment({ metadata: { email: { opensTicket: true } } })).toBe(false);
  });
  it('is false for malformed metadata', () => {
    expect(isTicketOpenerComment({ metadata: '{not json' })).toBe(false);
    expect(isTicketOpenerComment({ metadata: '"opensTicket"' })).toBe(false);
    expect(isTicketOpenerComment({ metadata: [true] })).toBe(false);
    expect(isTicketOpenerComment({ metadata: 7 })).toBe(false);
  });
});

describe('getTicketOpenerAttachmentCount', () => {
  it('reads positive counts from object or string metadata', () => {
    expect(getTicketOpenerAttachmentCount({ metadata: { attachmentCount: 2 } })).toBe(2);
    expect(getTicketOpenerAttachmentCount({ metadata: '{"attachmentCount":3}' })).toBe(3);
  });
  it('is null when unknown, zero or invalid', () => {
    expect(getTicketOpenerAttachmentCount({ metadata: {} })).toBeNull();
    expect(getTicketOpenerAttachmentCount({ metadata: { attachmentCount: 0 } })).toBeNull();
    expect(getTicketOpenerAttachmentCount({ metadata: { attachmentCount: '2' } })).toBeNull();
  });
});
