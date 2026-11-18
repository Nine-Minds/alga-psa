import type { AttachmentProducer } from '../types';
import { docxProducer } from './docx';
import { fallbackProducer } from './fallback';
import { htmlProducer } from './html';
import { imageProducer } from './image';
import { inAppProducer } from './inApp';
import { pdfProducer } from './pdf';
import { textProducer } from './text';

/**
 * The single ordered table. Lookup: exact MIME type, then `type/*` wildcard, then the fallback. Callers
 * never branch on a type; supporting XLSX later is one producer and one entry here.
 */
export const PRODUCERS: readonly AttachmentProducer[] = [
  imageProducer,
  pdfProducer,
  docxProducer,
  htmlProducer,
  textProducer,
];

export { inAppProducer, fallbackProducer };

export function selectProducer(effectiveMime: string, table: readonly AttachmentProducer[] = PRODUCERS): AttachmentProducer {
  const mime = effectiveMime.toLowerCase();
  const exact = table.find((p) => p.accepts.includes(mime));
  if (exact) return exact;
  const family = mime.split('/')[0];
  const wildcard = table.find((p) => p.accepts.includes(`${family}/*`));
  return wildcard ?? fallbackProducer;
}
