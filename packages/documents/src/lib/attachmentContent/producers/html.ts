import { LIMITS } from '../limits';
import { decodeText } from '../chunkText';
import { ProducerUnreadable, type AttachmentProducer } from '../types';
import { textUnitList } from './textUnits';

export async function htmlToMarkdown(html: string, opts: { dropImages?: boolean } = {}): Promise<string> {
  const mod: any = await import('turndown');
  const TurndownService = mod.default ?? mod;
  const service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  service.remove(['script', 'style', 'noscript', 'iframe', 'object', 'embed']);
  if (opts.dropImages) service.addRule('dropImages', { filter: 'img', replacement: () => '' });
  return String(service.turndown(html)).replace(/\n{3,}/g, '\n\n').trim();
}

export const htmlProducer: AttachmentProducer = {
  name: 'html',
  accepts: ['text/html', 'application/xhtml+xml'],
  maxBytes: LIMITS.maxTextBytes,
  async units(_source, bytes, ctx) {
    let markdown: string;
    try {
      markdown = await htmlToMarkdown(decodeText(bytes));
    } catch (error) {
      throw new ProducerUnreadable('unreadable_html', error instanceof Error ? error.message : String(error));
    }
    return textUnitList(markdown, ctx, `${ctx.effectiveMime} as Markdown`);
  },
};
