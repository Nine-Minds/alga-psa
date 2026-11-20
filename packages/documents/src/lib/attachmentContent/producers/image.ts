import { LIMITS } from '../limits';
import { normalizeImage } from '../normalizeImage';
import type { AttachmentProducer, ContentUnit } from '../types';
import { fallbackUnits } from './fallback';

export const imageProducer: AttachmentProducer = {
  name: 'image',
  accepts: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff', 'image/bmp', 'image/avif', 'image/heic', 'image/heif'],
  maxBytes: LIMITS.maxImageBytes,
  async units(source, bytes, ctx) {
    const unit: ContentUnit = {
      cost: () => ({ images: 1, encodedBytes: 0, textChars: 0 }),
      materialize: async () => {
        try {
          const img = await normalizeImage(bytes);
          const dims = img.scaled
            ? `scaled from ${img.sourceWidth}×${img.sourceHeight} to ${img.width}×${img.height}`
            : `${img.width}×${img.height}`;
          const type = img.mimeType === ctx.effectiveMime ? img.mimeType : `${ctx.effectiveMime} → ${img.mimeType}`;
          const parts = [type, dims, ...(ctx.mimeNote ? [ctx.mimeNote] : [])];
          return {
            label: `${ctx.tag} (${parts.join(', ')})`,
            blocks: [{ type: 'image', data: img.data.toString('base64'), mimeType: img.mimeType }],
            rendering: 'image',
          };
        } catch (error) {
          const detail = (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 160);
          return fallbackUnits(source, ctx, 'unreadable_image', detail).unit(0).materialize();
        }
      },
    };
    return { total: 1, unit: () => unit, describeRange: () => null };
  },
};
