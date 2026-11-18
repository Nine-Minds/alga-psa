import { LIMITS } from '../limits';
import { decodeText } from '../chunkText';
import type { AttachmentProducer } from '../types';
import { textUnitList } from './textUnits';

export const textProducer: AttachmentProducer = {
  name: 'text',
  accepts: ['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/xml', 'text/xml', 'text/*'],
  maxBytes: LIMITS.maxTextBytes,
  async units(_source, bytes, ctx) {
    return textUnitList(decodeText(bytes), ctx, ctx.effectiveMime);
  },
};
