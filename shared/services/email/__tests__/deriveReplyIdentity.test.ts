import { describe, expect, it } from 'vitest';
import { deriveReplyIdentity, readHeaderValues } from '../inboundEmailMimeHelpers';

describe('deriveReplyIdentity', () => {
  it('reads the Gmail payload.headers array shape and passes the Gmail threadId through', () => {
    const gmailHeaders = [
      { name: 'From', value: 'Jane <jane@client.example>' },
      { name: 'In-Reply-To', value: '<parent@alga.example>' },
      { name: 'References', value: '<root@alga.example> <parent@alga.example>' },
    ];
    expect(deriveReplyIdentity({ headers: gmailHeaders, conversationId: '18c2f0a1b2c3d4e5' })).toEqual({
      inReplyTo: '<parent@alga.example>',
      references: ['<root@alga.example>', '<parent@alga.example>'],
      threadId: '18c2f0a1b2c3d4e5',
    });
  });

  it('reads the Microsoft internetMessageHeaders shape and uses conversationId', () => {
    const graphHeaders = [
      { name: 'In-Reply-To', value: '<parent@alga.example>' },
      { name: 'References', value: '<root@alga.example>\r\n <parent@alga.example>' },
    ];
    expect(deriveReplyIdentity({ headers: graphHeaders, conversationId: 'AAQkAGI2-conv' })).toEqual({
      inReplyTo: '<parent@alga.example>',
      references: ['<root@alga.example>', '<parent@alga.example>'],
      threadId: 'AAQkAGI2-conv',
    });
  });

  it('reads the IMAP parsed-MIME map shape and roots threadId at the references chain', () => {
    expect(
      deriveReplyIdentity({
        headers: { references: ['<root@x>', '<mid@x>'], 'in-reply-to': '<mid@x>' },
      })
    ).toEqual({ inReplyTo: '<mid@x>', references: ['<root@x>', '<mid@x>'], threadId: '<root@x>' });
  });

  it('appends In-Reply-To when References omits it (common in Gmail payloads)', () => {
    expect(
      deriveReplyIdentity({ headers: [{ name: 'References', value: '<root@x>' }, { name: 'In-Reply-To', value: '<parent@x>' }] })
    ).toEqual({ inReplyTo: '<parent@x>', references: ['<root@x>', '<parent@x>'], threadId: '<root@x>' });
  });

  it('uses In-Reply-To alone as the chain when there is no References header', () => {
    expect(deriveReplyIdentity({ headers: { 'In-Reply-To': '<a@x>' } })).toEqual({
      inReplyTo: '<a@x>',
      references: ['<a@x>'],
      threadId: '<a@x>',
    });
  });

  it('leaves inReplyTo absent and keeps references when In-Reply-To is missing', () => {
    expect(deriveReplyIdentity({ headers: { References: '<r@x> <s@x>' } })).toEqual({
      references: ['<r@x>', '<s@x>'],
      threadId: '<r@x>',
    });
  });

  it('matches header names case-insensitively in both shapes', () => {
    const expected = { inReplyTo: '<a@x>', references: ['<r@x>', '<a@x>'], threadId: '<r@x>' };
    for (const headers of [
      { 'In-Reply-To': '<a@x>', References: '<r@x> <a@x>' },
      { 'in-reply-to': '<a@x>', references: '<r@x> <a@x>' },
      { 'IN-REPLY-TO': '<a@x>', REFERENCES: '<r@x> <a@x>' },
      [{ name: 'in-reply-to', value: '<a@x>' }, { name: 'rEfErEnCeS', value: '<r@x> <a@x>' }],
    ]) {
      expect(deriveReplyIdentity({ headers })).toEqual(expected);
    }
  });

  it('strips display-name noise from In-Reply-To and deduplicates References in order', () => {
    expect(
      deriveReplyIdentity({
        headers: {
          'In-Reply-To': 'Message from Jane of "Tue, 3 Nov" <parent@x>',
          References: '<root@x> <mid@x> <root@x>\r\n\t<parent@x>   <mid@x>',
        },
      })
    ).toEqual({ inReplyTo: '<parent@x>', references: ['<root@x>', '<mid@x>', '<parent@x>'], threadId: '<root@x>' });
  });

  it('keeps every value of a repeated header in source order', () => {
    const headers = [
      { name: 'References', value: '<a@x>' },
      { name: 'References', value: '<b@x>' },
    ];
    expect(readHeaderValues(headers, 'references')).toEqual(['<a@x>', '<b@x>']);
    expect(deriveReplyIdentity({ headers }).references).toEqual(['<a@x>', '<b@x>']);
  });

  it('yields no threading fields at all for an empty-header message', () => {
    for (const headers of [{}, [], null, undefined, { 'In-Reply-To': '', References: '  ' }]) {
      const out = deriveReplyIdentity({ headers });
      expect(out).toEqual({});
      expect(Object.keys(out)).toEqual([]);
    }
    expect(deriveReplyIdentity({})).toEqual({});
  });

  it('prefers a provider conversation id but ignores a blank one', () => {
    expect(deriveReplyIdentity({ headers: { References: '<r@x>' }, conversationId: 'conv-1' }).threadId).toBe('conv-1');
    expect(deriveReplyIdentity({ headers: {}, conversationId: 'conv-1' })).toEqual({ threadId: 'conv-1' });
    expect(deriveReplyIdentity({ headers: { References: '<r@x>' }, conversationId: '  ' }).threadId).toBe('<r@x>');
    expect(deriveReplyIdentity({ headers: { References: '<r@x>' }, conversationId: null }).threadId).toBe('<r@x>');
  });
});
