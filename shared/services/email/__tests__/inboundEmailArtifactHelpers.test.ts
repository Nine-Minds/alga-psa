import { describe, expect, it } from 'vitest';

import {
  buildDeterministicRfc822Message,
  extractEmbeddedImageAttachments,
  maybeExtractRawMimeFromEmailData,
} from '../inboundEmailArtifactHelpers';

describe('inboundEmailArtifactHelpers', () => {
  it('T218: data:image extraction emits deterministic synthetic attachment records', () => {
    const html = '<p>Hello<img src="data:image/png;base64,aGVsbG8=" /></p>';

    const first = extractEmbeddedImageAttachments({
      emailId: 'message-1@example.com',
      html,
      attachments: [],
    });
    const second = extractEmbeddedImageAttachments({
      emailId: 'message-1@example.com',
      html,
      attachments: [],
    });

    expect(first.warnings).toEqual([]);
    expect(first.attachments).toHaveLength(1);
    expect(first.attachments[0]).toMatchObject({
      id: expect.stringMatching(/^embedded-data-[a-f0-9]{24}$/),
      name: 'embedded-image-1.png',
      contentType: 'image/png',
      size: 5,
      source: 'data-url',
      allowInlineProcessing: true,
      content: 'aGVsbG8=',
    });
    expect(second.attachments[0]).toMatchObject({
      id: first.attachments[0].id,
      name: first.attachments[0].name,
      content: first.attachments[0].content,
    });
  });

  it('T219: only referenced CID inline parts are extracted and unreferenced inline parts are skipped', () => {
    const extracted = extractEmbeddedImageAttachments({
      emailId: 'message-2@example.com',
      html: '<p><img src="cid:ref-inline-1" /></p>',
      attachments: [
        {
          id: 'a-inline-ref',
          name: 'referenced.png',
          contentType: 'image/png',
          size: 6,
          contentId: '<ref-inline-1>',
          isInline: true,
          content: 'YWJjZGVm',
        },
        {
          id: 'a-inline-unref',
          name: 'unreferenced.png',
          contentType: 'image/png',
          size: 6,
          contentId: '<unreferenced-inline>',
          isInline: true,
          content: 'dW52YWw=',
        },
      ],
    });

    expect(extracted.warnings).toEqual([]);
    expect(extracted.attachments).toHaveLength(1);
    expect(extracted.attachments[0]).toMatchObject({
      id: expect.stringMatching(/^embedded-cid-[a-f0-9]{24}$/),
      providerAttachmentId: 'a-inline-ref',
      contentType: 'image/png',
      size: 6,
      source: 'cid',
    });
  });

  it('T221: raw MIME source selection prefers rawMimeBase64 then sourceMimeBase64 then rawSourceBase64', () => {
    const fromRawMime = maybeExtractRawMimeFromEmailData({
      rawMimeBase64: Buffer.from('raw-mime').toString('base64'),
      sourceMimeBase64: Buffer.from('source-mime').toString('base64'),
      rawSourceBase64: Buffer.from('raw-source').toString('base64'),
    });
    expect(fromRawMime?.toString('utf8')).toBe('raw-mime');

    const fromSourceMime = maybeExtractRawMimeFromEmailData({
      sourceMimeBase64: Buffer.from('source-mime').toString('base64'),
      rawSourceBase64: Buffer.from('raw-source').toString('base64'),
    });
    expect(fromSourceMime?.toString('utf8')).toBe('source-mime');

    const fromRawSource = maybeExtractRawMimeFromEmailData({
      rawSourceBase64: Buffer.from('raw-source').toString('base64'),
    });
    expect(fromRawSource?.toString('utf8')).toBe('raw-source');
  });

  it('T222: deterministic fallback MIME assembly is stable when raw MIME fields are absent', () => {
    const input = {
      id: 'message-3@example.com',
      receivedAt: '2026-02-27T12:34:56.000Z',
      from: { email: 'sender@example.com', name: 'Sender' },
      to: [{ email: 'support@example.com', name: 'Support' }],
      subject: 'Fallback subject',
      body: { text: 'Plain body', html: '<p>HTML body</p>' },
      references: ['orig-1@example.com'],
      inReplyTo: 'orig-1@example.com',
    };

    expect(maybeExtractRawMimeFromEmailData(input)).toBeNull();

    const first = buildDeterministicRfc822Message(input).toString('utf8');
    const second = buildDeterministicRfc822Message(input).toString('utf8');
    expect(first).toBe(second);
    expect(first).toContain('Message-ID: <message-3@example.com>');
    expect(first).toContain('Subject: Fallback subject');
    expect(first).toContain('Plain body');
    expect(first).toContain('<p>HTML body</p>');
  });
});
