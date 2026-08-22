import { describe, expect, it, vi } from 'vitest';
import {
  convertProseMirrorToTicketRichTextBlocks,
  createEmptyTicketMobileRichTextDocument,
  createTicketRichTextParagraph,
  extractTicketRichTextPlainText,
  parseTicketMobileRichTextDocument,
  parseTicketRichTextContent,
  serializeTicketMobileRichTextDocument,
  serializeTicketRichTextContent,
} from './ticketRichText';

describe('ticketRichText', () => {
  it('returns the default empty block for missing or blank content', () => {
    const emptyBlocks = createEmptyTicketMobileRichTextDocument().content;

    expect(parseTicketRichTextContent(undefined)).toEqual(emptyBlocks);
    expect(parseTicketRichTextContent(null)).toEqual(emptyBlocks);
    expect(parseTicketRichTextContent('')).toEqual(emptyBlocks);
    expect(parseTicketRichTextContent('   ')).toEqual(emptyBlocks);
  });

  it('parses legacy plain text into a blocknote paragraph document for mobile init', () => {
    expect(parseTicketMobileRichTextDocument('Legacy description')).toEqual({
      format: 'blocknote',
      sourceFormat: 'plain-text',
      content: createTicketRichTextParagraph('Legacy description'),
    });
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
    expect(parseTicketMobileRichTextDocument(serialized)).toEqual({
      format: 'blocknote',
      sourceFormat: 'blocknote',
      content: richText,
    });
  });

  it("parses ProseMirror '{type:\"doc\"}' payloads into the mobile runtime shape", () => {
    const document = {
      type: 'doc' as const,
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Mobile rich text',
              marks: [{ type: 'bold' }],
            },
          ],
        },
        {
          type: 'bullet_list',
          content: [
            {
              type: 'list_item',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Bullet item',
                      marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(parseTicketMobileRichTextDocument(JSON.stringify(document))).toEqual({
      format: 'prosemirror',
      sourceFormat: 'prosemirror',
      content: document,
    });
    expect(parseTicketRichTextContent(JSON.stringify(document))).toEqual([
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
            text: 'Mobile rich text',
            styles: { bold: true },
          },
        ],
      },
      {
        type: 'bulletListItem',
        props: {
          textAlignment: 'left',
          backgroundColor: 'default',
          textColor: 'default',
        },
        content: [
          {
            type: 'link',
            href: 'https://example.com',
            content: [
              {
                type: 'text',
                text: 'Bullet item',
                styles: {},
              },
            ],
          },
        ],
      },
    ]);
  });

  it('converts ProseMirror documents to BlockNote blocks for mobile save round-trips', () => {
    const document = {
      type: 'doc' as const,
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Heading' }],
        },
      ],
    };

    expect(convertProseMirrorToTicketRichTextBlocks(document)).toEqual([
      {
        type: 'heading',
        props: {
          textAlignment: 'left',
          backgroundColor: 'default',
          textColor: 'default',
          level: 2,
        },
        content: [
          {
            type: 'text',
            text: 'Heading',
            styles: {},
          },
        ],
      },
    ]);
  });

  it('handles content that is already parsed JSON instead of a string', () => {
    const blocks = [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Stored as jsonb array', styles: {} }],
      },
    ];

    expect(parseTicketMobileRichTextDocument(blocks)).toEqual({
      format: 'blocknote',
      sourceFormat: 'blocknote',
      content: blocks,
    });
    expect(parseTicketRichTextContent(blocks)).toEqual(blocks);

    const proseMirrorDoc = {
      type: 'doc' as const,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Stored as jsonb object' }] },
      ],
    };
    expect(parseTicketMobileRichTextDocument(proseMirrorDoc)).toEqual({
      format: 'prosemirror',
      sourceFormat: 'prosemirror',
      content: proseMirrorDoc,
    });

    expect(parseTicketMobileRichTextDocument([])).toEqual({
      format: 'blocknote',
      sourceFormat: 'blocknote',
      content: createEmptyTicketMobileRichTextDocument().content,
    });
    expect(parseTicketMobileRichTextDocument({ unexpected: 'shape' })).toEqual(
      createEmptyTicketMobileRichTextDocument()
    );
  });

  it('returns a safe empty mobile document for null, undefined, or blank values', () => {
    expect(parseTicketMobileRichTextDocument(undefined)).toEqual(
      createEmptyTicketMobileRichTextDocument()
    );
    expect(parseTicketMobileRichTextDocument(null)).toEqual(
      createEmptyTicketMobileRichTextDocument()
    );
    expect(parseTicketMobileRichTextDocument('')).toEqual(
      createEmptyTicketMobileRichTextDocument()
    );
    expect(parseTicketMobileRichTextDocument('   ')).toEqual(
      createEmptyTicketMobileRichTextDocument()
    );
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
    expect(
      serializeTicketMobileRichTextDocument(parseTicketMobileRichTextDocument(serialized))
    ).toBe(JSON.stringify(blocks));
  });

  it('extracts plain text from a single paragraph comment', () => {
    expect(
      extractTicketRichTextPlainText(
        serializeTicketRichTextContent(createTicketRichTextParagraph('Hello world'))
      )
    ).toBe('Hello world');
  });

  it('keeps interior blank lines between blocks and strips the trailing empty paragraph', () => {
    const blocks = [
      { type: 'paragraph', content: [{ type: 'text', text: 'First', styles: {} }] },
      { type: 'paragraph', content: [] },
      { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Second', styles: {} }] },
      { type: 'paragraph', content: [{ type: 'text', text: '', styles: {} }] },
    ];

    expect(extractTicketRichTextPlainText(JSON.stringify(blocks))).toBe('First\n\nSecond');
  });

  it('flattens nested list children onto their own lines', () => {
    const blocks = [
      {
        type: 'bulletListItem',
        content: [{ type: 'text', text: 'Parent', styles: {} }],
        children: [
          {
            type: 'bulletListItem',
            content: [{ type: 'text', text: 'Child', styles: {} }],
            children: [
              { type: 'bulletListItem', content: [{ type: 'text', text: 'Grandchild', styles: {} }] },
            ],
          },
        ],
      },
    ];

    expect(extractTicketRichTextPlainText(JSON.stringify(blocks))).toBe('Parent\nChild\nGrandchild');
  });

  it('preserves link text without the underlying URL markup', () => {
    const blocks = [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See ', styles: {} },
          {
            type: 'link',
            href: 'https://example.com/tickets/1',
            content: [{ type: 'text', text: 'the ticket', styles: {} }],
          },
        ],
      },
    ];

    expect(extractTicketRichTextPlainText(JSON.stringify(blocks))).toBe('See the ticket');
  });

  it('renders mentions the way the reader sees them', () => {
    const blocks = [
      {
        type: 'paragraph',
        content: [
          { type: 'mention', props: { userId: 'u1', username: 'glinda', displayName: 'Glinda' } },
          { type: 'text', text: ' and ', styles: {} },
          { type: 'mention', props: { userId: 'u2', username: '', displayName: 'Toto' } },
        ],
      },
    ];

    expect(extractTicketRichTextPlainText(JSON.stringify(blocks))).toBe('@glinda and @[Toto]');
  });

  it('returns an empty string for image-only comments', () => {
    const blocks = [
      { type: 'image', props: { url: '/api/documents/view/file-123', name: 'pasted-image.png' } },
    ];

    expect(extractTicketRichTextPlainText(JSON.stringify(blocks))).toBe('');
  });

  it('returns legacy plain-text notes verbatim', () => {
    expect(extractTicketRichTextPlainText('Legacy description')).toBe('Legacy description');
    expect(extractTicketRichTextPlainText('{"type":"paragraph"}')).toBe('{"type":"paragraph"}');
  });

  it('extracts text from ProseMirror documents written by the mobile editor', () => {
    const document = {
      type: 'doc' as const,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Mobile rich text' }] },
        {
          type: 'bullet_list',
          content: [
            {
              type: 'list_item',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bullet item' }] }],
            },
          ],
        },
      ],
    };

    expect(extractTicketRichTextPlainText(JSON.stringify(document))).toBe(
      'Mobile rich text\nBullet item'
    );
  });

  it('returns an empty string for missing or blank content', () => {
    expect(extractTicketRichTextPlainText(null)).toBe('');
    expect(extractTicketRichTextPlainText(undefined)).toBe('');
    expect(extractTicketRichTextPlainText('')).toBe('');
    expect(extractTicketRichTextPlainText('   ')).toBe('');
    expect(extractTicketRichTextPlainText([])).toBe('');
  });
});
