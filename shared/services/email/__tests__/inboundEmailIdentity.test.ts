import { describe, expect, it } from 'vitest';
import {
  buildArtifactKey,
  buildArtifactStorageKey,
  buildInboundSourceObjectKey,
  buildIngressKey,
  buildOutboxEventKey,
  normalizeInboundMessageIdentity,
} from '../inboundEmailIdentity';

describe('normalizeInboundMessageIdentity', () => {
  it('prefers the RFC 5322 Message-ID, lowercasing only the domain', () => {
    const result = normalizeInboundMessageIdentity({
      providerType: 'microsoft',
      rfcMessageId: '<AbC.123@Example.COM>',
      providerMessageId: 'graph-id-1',
    });
    expect(result).toEqual({
      normalized: 'rfc822:AbC.123@example.com',
      scheme: 'rfc822',
      rfcMessageId: 'AbC.123@example.com',
      providerMessageId: null,
    });
  });

  it('removes exactly one surrounding pair of angle brackets', () => {
    const result = normalizeInboundMessageIdentity({
      providerType: 'google',
      rfcMessageId: '  <plain@example.com>  ',
    });
    expect(result?.normalized).toBe('rfc822:plain@example.com');
  });

  it('falls back to a provider-native id without lowercasing opaque ids', () => {
    const result = normalizeInboundMessageIdentity({
      providerType: 'microsoft',
      rfcMessageId: null,
      providerMessageId: ' AAKjEGis... ',
    });
    expect(result).toEqual({
      normalized: 'provider:microsoft:AAKjEGis...',
      scheme: 'provider',
      rfcMessageId: null,
      providerMessageId: 'AAKjEGis...',
    });
  });

  it('uses imap:<mailbox>:<uidvalidity>:<uid> when neither id exists', () => {
    const result = normalizeInboundMessageIdentity({
      providerType: 'imap',
      mailbox: 'INBOX',
      uidValidity: '12345',
      uid: 678,
    });
    expect(result?.normalized).toBe('imap:INBOX:12345:678');
  });

  it('returns null for a UID without UIDVALIDITY (not a durable identity)', () => {
    const result = normalizeInboundMessageIdentity({
      providerType: 'imap',
      mailbox: 'INBOX',
      uidValidity: null,
      uid: 678,
    });
    expect(result).toBeNull();
  });

  it('returns null when no identity source is present', () => {
    expect(normalizeInboundMessageIdentity({ providerType: 'google' })).toBeNull();
  });
});

describe('deterministic key builders', () => {
  it('builds a source object key that never exposes the message id', () => {
    const key = buildInboundSourceObjectKey({
      tenant: 't',
      providerId: 'p',
      normalizedMessageId: 'rfc822:secret@example.com',
      sourceSha256: 'abc123',
    });
    expect(key).toContain('inbound-email/t/p/');
    expect(key).toContain('/abc123.eml');
    expect(key).not.toContain('secret');
    // Deterministic for the same identity+digest.
    expect(buildInboundSourceObjectKey({
      tenant: 't',
      providerId: 'p',
      normalizedMessageId: 'rfc822:secret@example.com',
      sourceSha256: 'abc123',
    })).toBe(key);
  });

  it('builds deterministic artifact and outbox keys', () => {
    expect(buildArtifactKey({ artifactType: 'attachment', stableId: 'att-1' })).toBe('attachment:att-1');
    expect(buildOutboxEventKey({ eventKind: 'ticket-created' })).toBe('ticket-created');
    expect(buildOutboxEventKey({ eventKind: 'reply-comment-created', extra: 'inbox-9' })).toBe('reply-comment-created:inbox-9');
  });

  it('builds deterministic ingress keys per provider form', () => {
    expect(buildIngressKey({ providerType: 'microsoft', providerMessageId: 'msg-1' })).toBe('message:msg-1');
    expect(buildIngressKey({ providerType: 'google', historyId: '123', pubsubMessageId: 'pub-1' })).toBe('history:123:pub-1');
    expect(buildIngressKey({ providerType: 'imap', mailbox: 'INBOX', uidValidity: '9', uid: 5 })).toBe('mailbox:INBOX:uidvalidity:9:uid:5');
  });

  it('artifact storage key is deterministic and digest-derived', () => {
    const a = buildArtifactStorageKey({ tenant: 't', inboxId: 'i', artifactKey: 'attachment:a', contentDigest: 'digest-1', fileName: 'x.pdf' });
    const b = buildArtifactStorageKey({ tenant: 't', inboxId: 'i', artifactKey: 'attachment:a', contentDigest: 'digest-1', fileName: 'x.pdf' });
    expect(a).toBe(b);
    expect(a).toContain('inbound-artifacts/t/i/');
    expect(a).toContain('x.pdf');
  });
});
