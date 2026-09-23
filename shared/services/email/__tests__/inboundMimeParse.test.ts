import { describe, expect, it } from 'vitest';
import { simpleParser } from 'mailparser';

import { INBOUND_MIME_PARSE_OPTIONS } from '../inboundMimeParseOptions';
import { parseStagedMimeIntoEmailDetails } from '../inboundEmailSourceStager';
import { extractEmbeddedImageAttachments } from '../inboundEmailArtifactHelpers';

// One inline PNG referenced once from the HTML body, plus a voicemail .wav.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

function buildSingleCidMime(): Buffer {
  const outer = 'outer-boundary';
  const related = 'related-boundary';
  return Buffer.from(
    [
      'From: Voicemail Caller <caller@example.test>',
      'To: support@example.test',
      'Subject: Voicemail',
      'Message-ID: <single-cid@example.test>',
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${outer}"`,
      '',
      `--${outer}`,
      `Content-Type: multipart/related; boundary="${related}"`,
      '',
      `--${related}`,
      'Content-Type: text/html; charset="utf-8"',
      '',
      '<p>New voicemail</p><img src="cid:smoke-logo" alt="Smoke logo">',
      `--${related}`,
      'Content-Type: image/png',
      'Content-Transfer-Encoding: base64',
      'Content-ID: <smoke-logo>',
      'Content-Disposition: inline; filename="smoke-logo.png"',
      '',
      PNG_BASE64,
      `--${related}--`,
      `--${outer}`,
      'Content-Type: audio/wav; name="voicemail.wav"',
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="voicemail.wav"',
      '',
      Buffer.from('RIFF....WAVEfmt ').toString('base64'),
      `--${outer}--`,
      '',
    ].join('\r\n')
  );
}

describe('inbound MIME parsing keeps CID links', () => {
  it('mailparser default rewrites cid: to a data URL (the duplicate-image trap this guards against)', async () => {
    const parsed = await simpleParser(buildSingleCidMime());
    expect(String(parsed.html)).toContain('data:image/png;base64,');
    expect(String(parsed.html)).not.toContain('cid:smoke-logo');
    expect(parsed.attachments.some((a) => a.contentId === '<smoke-logo>')).toBe(true);
  });

  it('parseStagedMimeIntoEmailDetails preserves the cid: reference and the inline part exactly once', async () => {
    const { emailData } = await parseStagedMimeIntoEmailDetails({
      tenant: 'tenant-1',
      providerId: 'provider-1',
      providerType: 'imap',
      rawMime: buildSingleCidMime(),
      mailbox: 'INBOX',
      uidValidity: '1',
      uid: 42,
    });

    expect(emailData.body.html).toContain('src="cid:smoke-logo"');
    expect(emailData.body.html).not.toContain('data:image/png;base64,');

    const inlineParts = emailData.attachments.filter((a) => a.contentId === '<smoke-logo>');
    expect(inlineParts).toHaveLength(1);
    expect(inlineParts[0]).toMatchObject({ name: 'smoke-logo.png', contentType: 'image/png', isInline: true });
    expect(emailData.attachments.filter((a) => a.name === 'voicemail.wav')).toHaveLength(1);

    // Embedded extraction now yields a single CID-sourced record bound to the
    // original part, so the base attachment is marked consumed instead of
    // being persisted as a second copy.
    const extraction = extractEmbeddedImageAttachments({
      emailId: emailData.id,
      html: emailData.body.html,
      attachments: emailData.attachments,
    });
    expect(extraction.attachments).toHaveLength(1);
    expect(extraction.attachments[0]).toMatchObject({
      source: 'cid',
      name: 'smoke-logo.png',
      providerAttachmentId: inlineParts[0].id,
    });
    expect(extraction.attachments.filter((a) => a.source === 'data-url')).toHaveLength(0);
  });

  it('exports the option every inbound parse site uses', () => {
    expect(INBOUND_MIME_PARSE_OPTIONS).toEqual({ keepCidLinks: true });
  });
});
