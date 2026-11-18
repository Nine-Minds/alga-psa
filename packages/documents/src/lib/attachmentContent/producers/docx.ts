import { LIMITS } from '../limits';
import { ProducerUnreadable, type AttachmentProducer } from '../types';
import { textUnitList } from './textUnits';
import { htmlToMarkdown } from './html';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const docxProducer: AttachmentProducer = {
  name: 'docx',
  accepts: [DOCX_MIME],
  maxBytes: LIMITS.maxDocxBytes,
  async units(_source, bytes, ctx) {
    let html: string;
    let images = 0;
    try {
      const mammoth: any = await import('mammoth');
      const api = mammoth.default ?? mammoth;
      const result = await api.convertToHtml(
        { buffer: bytes },
        {
          // Embedded pictures are dropped (counted in the label), never inlined as data: URIs.
          convertImage: api.images.imgElement(async () => {
            images += 1;
            return { src: '' };
          }),
        },
      );
      html = String(result.value ?? '');
    } catch (error) {
      throw new ProducerUnreadable('unreadable_docx', error instanceof Error ? error.message : String(error));
    }
    const markdown = await htmlToMarkdown(html, { dropImages: true });
    const notes = images > 0 ? [`${images} embedded image${images === 1 ? '' : 's'} not included`] : [];
    return textUnitList(markdown, ctx, 'DOCX as Markdown', { extraNotes: notes });
  },
};
