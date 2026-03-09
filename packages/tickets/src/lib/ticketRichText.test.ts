import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BLOCK } from '@alga-psa/ui/editor';
import {
  createTicketRichTextParagraph,
  parseTicketRichTextContent,
  serializeTicketRichTextContent,
} from './ticketRichText';

describe('ticketRichText', () => {
  it('returns the default empty block for missing or blank content', () => {
    expect(parseTicketRichTextContent(undefined)).toEqual(DEFAULT_BLOCK);
    expect(parseTicketRichTextContent(null)).toEqual(DEFAULT_BLOCK);
    expect(parseTicketRichTextContent('')).toEqual(DEFAULT_BLOCK);
    expect(parseTicketRichTextContent('   ')).toEqual(DEFAULT_BLOCK);
  });

  it('parses serialized BlockNote JSON without mutating the content', () => {
    const richText = [
      {
        type: 'paragraph',
        props: {
          textAlignment: 'left',
          backgroundColor: 'default',
          textColor: 'default',
        },
        content: [
          {
            type: 'text',
            text: 'Hello world',
            styles: { bold: true },
          },
        ],
      },
      {
        type: 'image',
        props: {
          url: '/api/documents/view/file-123',
          name: 'pasted-image.png',
        },
      },
    ];
    const serialized = JSON.stringify(richText);

    expect(parseTicketRichTextContent(serialized)).toEqual(richText);
  });

  it('falls back to a paragraph block for plain text and malformed JSON', () => {
    const parseErrorSpy = vi.fn();

    expect(parseTicketRichTextContent('Legacy description')).toEqual(
      createTicketRichTextParagraph('Legacy description')
    );
    expect(parseTicketRichTextContent('{"type":"paragraph"}')).toEqual(
      createTicketRichTextParagraph('{"type":"paragraph"}')
    );
    expect(
      parseTicketRichTextContent('[not valid json', {
        onParseError: parseErrorSpy,
      })
    ).toEqual(createTicketRichTextParagraph('[not valid json'));
    expect(parseErrorSpy).toHaveBeenCalledTimes(1);
  });

  it('serializes rich-text blocks deterministically for save round-trips', () => {
    const blocks = createTicketRichTextParagraph('Saved description');

    const serialized = serializeTicketRichTextContent(blocks);

    expect(serialized).toBe(JSON.stringify(blocks));
    expect(parseTicketRichTextContent(serialized)).toEqual(blocks);
  });
});
