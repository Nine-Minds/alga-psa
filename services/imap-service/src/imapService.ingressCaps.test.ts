import { describe, expect, it } from 'vitest';
import { applyImapIngressCaps } from './imapService';

function attachment(params: {
  id: string;
  size: number;
  name?: string;
  contentType?: string;
  contentDisposition?: string;
}) {
  return {
    checksum: params.id,
    filename: params.name || `${params.id}.bin`,
    contentType: params.contentType || 'application/octet-stream',
    contentDisposition: params.contentDisposition || 'attachment',
    size: params.size,
    content: Buffer.alloc(params.size, 1),
  };
}

describe('applyImapIngressCaps', () => {
  it('T037: skips attachments that exceed per-attachment byte cap with structured reason', () => {
    const result = applyImapIngressCaps({
      parsedAttachments: [attachment({ id: 'a1', size: 9 })],
      rawMimeBuffer: Buffer.from('ok'),
      caps: {
        maxAttachmentBytes: 8,
        maxTotalAttachmentBytes: 32,
        maxAttachmentCount: 10,
        maxRawMimeBytes: 1024,
      },
    });

    expect(result.attachments).toHaveLength(0);
    expect(result.ingressSkipReasons).toContainEqual(
      expect.objectContaining({
        type: 'attachment',
        reason: 'attachment_over_max_bytes',
        attachmentId: 'a1',
        size: 9,
        cap: 8,
      })
    );
  });

  it('T038: enforces total attachment byte cap and skips excess artifacts with reason', () => {
    const result = applyImapIngressCaps({
      parsedAttachments: [
        attachment({ id: 'a1', size: 4 }),
        attachment({ id: 'a2', size: 4 }),
        attachment({ id: 'a3', size: 4 }),
      ],
      rawMimeBuffer: Buffer.from('ok'),
      caps: {
        maxAttachmentBytes: 10,
        maxTotalAttachmentBytes: 8,
        maxAttachmentCount: 10,
        maxRawMimeBytes: 1024,
      },
    });

    expect(result.attachments.map((item) => item.id)).toEqual(['a1', 'a2']);
    expect(result.ingressSkipReasons).toContainEqual(
      expect.objectContaining({
        type: 'attachment',
        reason: 'attachment_total_bytes_exceeded',
        attachmentId: 'a3',
        size: 4,
        cap: 8,
      })
    );
  });

  it('T039: enforces attachment-count cap and skips overflow artifacts with reason', () => {
    const result = applyImapIngressCaps({
      parsedAttachments: [
        attachment({ id: 'a1', size: 1 }),
        attachment({ id: 'a2', size: 1 }),
        attachment({ id: 'a3', size: 1 }),
      ],
      rawMimeBuffer: Buffer.from('ok'),
      caps: {
        maxAttachmentBytes: 10,
        maxTotalAttachmentBytes: 10,
        maxAttachmentCount: 2,
        maxRawMimeBytes: 1024,
      },
    });

    expect(result.attachments.map((item) => item.id)).toEqual(['a1', 'a2']);
    expect(result.ingressSkipReasons).toContainEqual(
      expect.objectContaining({
        type: 'attachment',
        reason: 'attachment_count_exceeded',
        attachmentId: 'a3',
        size: 1,
        cap: 2,
      })
    );
  });

  it('T040: drops raw MIME payload when it exceeds cap with structured reason', () => {
    const result = applyImapIngressCaps({
      parsedAttachments: [attachment({ id: 'a1', size: 1 })],
      rawMimeBuffer: Buffer.alloc(16, 1),
      caps: {
        maxAttachmentBytes: 10,
        maxTotalAttachmentBytes: 10,
        maxAttachmentCount: 10,
        maxRawMimeBytes: 8,
      },
    });

    expect(result.rawMimeBase64).toBeUndefined();
    expect(result.ingressSkipReasons).toContainEqual(
      expect.objectContaining({
        type: 'raw_mime',
        reason: 'raw_mime_over_max_bytes',
        size: 16,
        cap: 8,
      })
    );
  });
});
