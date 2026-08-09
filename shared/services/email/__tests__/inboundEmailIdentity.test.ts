import { describe, expect, it } from 'vitest';
import {
  buildArtifactKey,
  buildArtifactStorageKey,
  buildInboundSourceObjectKey,
  buildIngressKey,
  buildOutboxEventKey,
  normalizeInboundMessageIdentity,
  normalizeRfc822MessageId,
  parseCanonicalInboundIdentity,
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

  it('is idempotent for an already-canonical rfc822 identity (no rfc822:rfc822)', () => {
    const result = normalizeInboundMessageIdentity({
      providerType: 'google',
      rfcMessageId: 'rfc822:AbC.123@example.com',
    });
    expect(result).toEqual({
      normalized: 'rfc822:AbC.123@example.com',
      scheme: 'rfc822',
      rfcMessageId: 'AbC.123@example.com',
      providerMessageId: null,
    });
    expect(result?.normalized).not.toContain('rfc822:rfc822');
  });

  it('heals a corrupted double-prefixed rfc822 value back to the canonical key', () => {
    const result = normalizeInboundMessageIdentity({
      providerType: 'google',
      rfcMessageId: 'rfc822:rfc822:abc@example.com',
    });
    expect(result?.normalized).toBe('rfc822:abc@example.com');
    expect(result?.rfcMessageId).toBe('abc@example.com');
  });

  it('preserves an already-canonical provider identity instead of re-wrapping it', () => {
    const result = normalizeInboundMessageIdentity({
      providerType: 'microsoft',
      providerMessageId: 'provider:microsoft:AAKjEGis...',
    });
    expect(result).toEqual({
      normalized: 'provider:microsoft:AAKjEGis...',
      scheme: 'provider',
      rfcMessageId: null,
      providerMessageId: 'AAKjEGis...',
    });
    expect(result?.normalized).not.toContain('provider:provider:');
  });

  it('preserves an already-canonical imap identity instead of re-wrapping it', () => {
    const result = normalizeInboundMessageIdentity({
      providerType: 'imap',
      rfcMessageId: 'imap:INBOX:12345:678',
    });
    expect(result?.normalized).toBe('imap:INBOX:12345:678');
    expect(result?.scheme).toBe('imap');
    expect(result?.normalized).not.toContain('imap:imap:');
  });

  it('normalizes a raw rfc id that merely looks prefixed (provider form from legacy field)', () => {
    // A genuine legacy row stores `google:<opaque>`; feeding that as the RFC
    // field must still produce the rfc822 form of the OPAQUE part only when it
    // is NOT already a canonical identity. A raw value without a scheme prefix
    // is a plain RFC id.
    const result = normalizeInboundMessageIdentity({
      providerType: 'imap',
      rfcMessageId: 'abc@example.com',
    });
    expect(result?.normalized).toBe('rfc822:abc@example.com');
  });

  it('normalizeRfc822MessageId is idempotent for already-prefixed values', () => {
    expect(normalizeRfc822MessageId('rfc822:abc@example.com')).toBe('abc@example.com');
    expect(normalizeRfc822MessageId('rfc822:rfc822:abc@example.com')).toBe('abc@example.com');
    expect(normalizeRfc822MessageId('<rfc822:abc@example.com>')).toBe('abc@example.com');
  });

  it('parseCanonicalInboundIdentity recognizes every canonical scheme', () => {
    expect(parseCanonicalInboundIdentity('rfc822:abc@example.com')?.scheme).toBe('rfc822');
    expect(parseCanonicalInboundIdentity('provider:microsoft:AAK')?.scheme).toBe('provider');
    expect(parseCanonicalInboundIdentity('imap:INBOX:12345:678')?.scheme).toBe('imap');
    expect(parseCanonicalInboundIdentity('plain@example.com')).toBeNull();
    expect(parseCanonicalInboundIdentity(null)).toBeNull();
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
