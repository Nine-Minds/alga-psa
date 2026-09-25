import { describe, expect, it } from 'vitest';
import { inboundSenderLabel } from '../../../lib/api/services/ticketCommentAuthor';

describe('inboundSenderLabel', () => {
  it('prefers the sender name, then falls back to the address', () => {
    expect(inboundSenderLabel({ email: { fromName: ' Jane Doe ', fromAddress: 'jane@example.com' } })).toBe('Jane Doe');
    expect(inboundSenderLabel({ email: { fromName: '', fromAddress: 'jane@example.com' } })).toBe('jane@example.com');
    expect(inboundSenderLabel({ email: { from: { name: 'Jane', email: 'jane@example.com' } } })).toBe('Jane');
    expect(inboundSenderLabel({ email: { from: { email: 'jane@example.com' } } })).toBe('jane@example.com');
  });

  it('returns null when metadata carries no sender', () => {
    expect(inboundSenderLabel(null)).toBeNull();
    expect(inboundSenderLabel(undefined)).toBeNull();
    expect(inboundSenderLabel({})).toBeNull();
    expect(inboundSenderLabel({ email: 'not-an-object' })).toBeNull();
    expect(inboundSenderLabel({ email: [] })).toBeNull();
    expect(inboundSenderLabel({ email: { from: [] } })).toBeNull();
    expect(inboundSenderLabel({ email: { fromName: '   ', from: { name: 42 } } })).toBeNull();
  });
});
