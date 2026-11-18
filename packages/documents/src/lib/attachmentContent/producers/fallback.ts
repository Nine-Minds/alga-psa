import type { AttachmentProducer, AttachmentSource, ContentUnit, ProducerCtx, UnitList } from '../types';

const REASON_TEXT: Record<string, string> = {
  unsupported_type: 'content type not readable through read_attachment; the user can open it in Alga',
  too_large: 'file is too large to read through read_attachment; the user can open it in Alga',
  encrypted_pdf: 'the PDF is encrypted; the user can open it in Alga',
  unreadable_image: 'the image could not be decoded',
  unreadable: 'the file could not be read',
};

function humanSize(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes)) return null;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

/**
 * Metadata plus a resource_link; bytes are never emitted. The one place a file that cannot be read is
 * described, so every producer's failure ends here with a stated reason.
 */
export function fallbackUnits(
  source: AttachmentSource,
  ctx: ProducerCtx,
  reason: string,
  detail?: string,
): UnitList {
  const doc = source.document;
  const unit: ContentUnit = {
    cost: () => ({ images: 0, encodedBytes: 0, textChars: 0 }),
    materialize: async () => {
      const size = humanSize(doc.file_size);
      const bits = [ctx.effectiveMime, size].filter(Boolean).join(', ');
      const why = REASON_TEXT[reason] ?? REASON_TEXT.unreadable;
      return {
        label: `${ctx.tag} (${bits}): ${why}${detail ? ` (${detail})` : ''}.`,
        blocks: [
          {
            type: 'resource_link',
            uri: ctx.documentUri(doc.document_id),
            name: doc.document_name,
            ...(ctx.effectiveMime ? { mimeType: ctx.effectiveMime } : {}),
            ...(doc.file_size !== null && Number.isFinite(doc.file_size) ? { size: doc.file_size } : {}),
          },
        ],
        rendering: 'link',
        omitted: { reason },
      };
    },
  };
  return { total: 1, unit: () => unit, describeRange: () => null };
}

export const fallbackProducer: AttachmentProducer = {
  name: 'fallback',
  accepts: [],
  maxBytes: Number.POSITIVE_INFINITY,
  async units(source, _bytes, ctx) {
    return fallbackUnits(source, ctx, 'unsupported_type');
  },
};
