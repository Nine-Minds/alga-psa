import { LIMITS } from '../limits';
import { ProducerUnreadable, type AttachmentProducer } from '../types';
import { textUnitList } from './textUnits';

/** Documents without a stored file: BlockNote / text bodies, through the existing Markdown conversion. */
export const inAppProducer: AttachmentProducer = {
  name: 'inApp',
  accepts: [],
  maxBytes: LIMITS.maxTextBytes,
  async units(source, _bytes, ctx) {
    const markdown = await source.loadInAppMarkdown();
    if (!markdown || markdown.trim() === '') throw new ProducerUnreadable('no_content', 'The document has no content.');
    return textUnitList(markdown, ctx, 'in-app document as Markdown');
  },
};
