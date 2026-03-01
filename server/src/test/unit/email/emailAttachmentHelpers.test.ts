import { describe, expect, it } from 'vitest';

import {
  buildDeterministicRfc822Message,
  buildOriginalEmailFileName,
  extractEmbeddedImageAttachments,
  maybeExtractRawMimeFromEmailData,
} from '@shared/services/email/inboundEmailArtifactHelpers';

describe('emailAttachmentHelpers', () => {
  it('extracts data:image payload from a single <img> tag', () => {
    const result = extractEmbeddedImageAttachments({
      emailId: 'm1',
      html: '<img src="data:image/png;base64,aGVsbG8=" />',
      attachments: [],
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].source).toBe('data-url');
    expect(result.attachments[0].contentType).toBe('image/png');
    expect(result.attachments[0].name).toBe('embedded-image-1.png');
  });

  it('extracts multiple data:image payloads in deterministic order', () => {
    const html = [
      '<img src="data:image/png;base64,Zmlyc3Q=" />',
      '<img src="data:image/jpeg;base64,c2Vjb25k" />',
    ].join('');

    const first = extractEmbeddedImageAttachments({ emailId: 'm2', html, attachments: [] });
    const second = extractEmbeddedImageAttachments({ emailId: 'm2', html, attachments: [] });

    expect(first.attachments).toHaveLength(2);
    expect(first.attachments.map((item) => item.id)).toEqual(second.attachments.map((item) => item.id));
    expect(first.attachments[0].name).toBe('embedded-image-1.png');
    expect(first.attachments[1].name).toBe('embedded-image-2.jpg');
  });

  it('skips malformed data:image payload without throwing', () => {
    const result = extractEmbeddedImageAttachments({
      emailId: 'm3',
      html: '<img src="data:image/png;base64,###not-base64###" />',
      attachments: [],
    });

    expect(result.attachments).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.startsWith('skipped_invalid_data_url'))).toBe(true);
  });

  it('rejects non-image data URLs', () => {
    const result = extractEmbeddedImageAttachments({
      emailId: 'm4',
      html: '<img src="data:text/plain;base64,aGVsbG8=" />',
      attachments: [],
    });

    expect(result.attachments).toHaveLength(0);
  });

  it('skips oversized embedded data URL payloads based on max-size policy', () => {
    const oversizedBase64 = 'A'.repeat(1024);
    const result = extractEmbeddedImageAttachments({
      emailId: 'm5',
      html: `<img src="data:image/png;base64,${oversizedBase64}" />`,
      attachments: [],
      maxBytes: 10,
    });

    expect(result.attachments).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.startsWith('skipped_oversize_data_url'))).toBe(true);
  });

  it('maps cid references only to matching inline image MIME parts', () => {
    const result = extractEmbeddedImageAttachments({
      emailId: 'm6',
      html: '<img src="cid:match-1" /><img src="cid:missing" />',
      attachments: [
        { id: 'a1', name: 'inline.png', contentType: 'image/png', size: 10, contentId: '<match-1>', isInline: true },
        { id: 'a2', name: 'doc.pdf', contentType: 'application/pdf', size: 10, contentId: '<match-2>', isInline: true },
      ],
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].source).toBe('cid');
    expect(result.attachments[0].providerAttachmentId).toBe('a1');
    expect(result.warnings.some((warning) => warning.startsWith('missing_cid_attachment'))).toBe(true);
  });

  it('skips unreferenced inline CID MIME parts', () => {
    const result = extractEmbeddedImageAttachments({
      emailId: 'm7',
      html: '<p>No cid references</p>',
      attachments: [
        { id: 'a1', name: 'inline.png', contentType: 'image/png', size: 10, contentId: '<match-1>', isInline: true },
      ],
    });

    expect(result.attachments).toHaveLength(0);
  });

  it('generates deterministic embedded IDs and sanitized filenames', () => {
    const html = '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" />';
    const first = extractEmbeddedImageAttachments({ emailId: 'm8', html, attachments: [] });
    const second = extractEmbeddedImageAttachments({ emailId: 'm8', html, attachments: [] });

    expect(first.attachments[0].id).toBe(second.attachments[0].id);
    expect(first.attachments[0].name).toBe('embedded-image-1.svg');
  });

  it('builds deterministic original-email filename', () => {
    const name = buildOriginalEmailFileName('<Message.Id+Value@example.com>');
    expect(name).toBe('original-email-Message.Id-Value-example.com.eml');
  });

  it('returns raw MIME bytes when MailHog/raw source content is available', () => {
    const mime = Buffer.from('From: a@example.com\r\n\r\nhello', 'utf8').toString('base64');
    const extracted = maybeExtractRawMimeFromEmailData({ rawMimeBase64: mime });
    expect(extracted).toBeTruthy();
    expect(extracted?.toString('utf8')).toContain('From: a@example.com');
  });

  it('builds deterministic RFC822 fallback MIME when raw source is absent', () => {
    const emailData = {
      id: 'mailhog-message-1',
      from: { email: 'sender@example.com', name: 'Sender' },
      to: [{ email: 'support@example.com', name: 'Support' }],
      subject: 'Fallback',
      body: { text: 'Hello', html: '<p>Hello</p>' },
      receivedAt: '2026-01-01T00:00:00.000Z',
    };

    const first = buildDeterministicRfc822Message(emailData).toString('utf8');
    const second = buildDeterministicRfc822Message(emailData).toString('utf8');
    expect(first).toBe(second);
    expect(first).toContain('Subject: Fallback');
    expect(first).toContain('Content-Type: multipart/alternative');
  });
});
