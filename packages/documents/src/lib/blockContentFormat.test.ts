import { blockNoteJsonToProsemirrorJson, detectBlockContentFormat } from './blockContentFormat';

describe('detectBlockContentFormat', () => {
  it('detects BlockNote JSON arrays with props', () => {
    const blocknote = [
      {
        type: 'paragraph',
        props: { textAlignment: 'left' },
        content: [{ type: 'text', text: 'Hello', styles: {} }],
      },
    ];

    expect(detectBlockContentFormat(blocknote)).toBe('blocknote');
  });

  it('detects ProseMirror JSON documents', () => {
    const prosemirror = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
    };

    expect(detectBlockContentFormat(prosemirror)).toBe('prosemirror');
  });

  it('treats null/empty as empty format', () => {
    expect(detectBlockContentFormat(null)).toBe('empty');
    expect(detectBlockContentFormat([])).toBe('empty');
  });

  it('converts paragraph blocks to ProseMirror paragraphs', () => {
    const blocknote = [
      {
        type: 'paragraph',
        props: { textAlignment: 'left' },
        content: [{ type: 'text', text: 'Hello', styles: {} }],
      },
    ];

    expect(blockNoteJsonToProsemirrorJson(blocknote)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
    });
  });

  it('converts styled text to ProseMirror marks', () => {
    const blocknote = [
      {
        type: 'paragraph',
        props: {},
        content: [
          {
            type: 'text',
            text: 'Styled',
            styles: { bold: true, italic: true, underline: true },
          },
        ],
      },
    ];

    const result = blockNoteJsonToProsemirrorJson(blocknote);
    const marks = result.content[0]?.content?.[0]?.marks || [];

    expect(marks).toEqual(
      expect.arrayContaining([
        { type: 'bold' },
        { type: 'italic' },
        { type: 'underline' },
      ])
    );
  });

  it('converts heading blocks (levels 1-3) to ProseMirror headings', () => {
    const blocknote = [
      {
        type: 'heading',
        props: { level: 1 },
        content: [{ type: 'text', text: 'Title', styles: {} }],
      },
      {
        type: 'heading',
        props: { level: 2 },
        content: [{ type: 'text', text: 'Subtitle', styles: {} }],
      },
      {
        type: 'heading',
        props: { level: 3 },
        content: [{ type: 'text', text: 'Section', styles: {} }],
      },
    ];

    expect(blockNoteJsonToProsemirrorJson(blocknote)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Title' }],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Subtitle' }],
        },
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'Section' }],
        },
      ],
    });
  });

  it('converts bullet list items to ProseMirror bullet_list nodes', () => {
    const blocknote = [
      {
        type: 'bulletListItem',
        props: {},
        content: [{ type: 'text', text: 'Bullet', styles: {} }],
      },
    ];

    expect(blockNoteJsonToProsemirrorJson(blocknote)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'bullet_list',
          content: [
            {
              type: 'list_item',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Bullet' }],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('converts numbered list items to ProseMirror ordered_list nodes', () => {
    const blocknote = [
      {
        type: 'numberedListItem',
        props: { number: 2 },
        content: [{ type: 'text', text: 'Step', styles: {} }],
      },
    ];

    expect(blockNoteJsonToProsemirrorJson(blocknote)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'ordered_list',
          attrs: { order: 2 },
          content: [
            {
              type: 'list_item',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Step' }],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('converts link inline content to ProseMirror link marks', () => {
    const blocknote = [
      {
        type: 'paragraph',
        props: {},
        content: [
          {
            type: 'link',
            href: 'https://example.com',
            content: [{ type: 'text', text: 'Example', styles: {} }],
          },
        ],
      },
    ];

    expect(blockNoteJsonToProsemirrorJson(blocknote)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Example',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
            },
          ],
        },
      ],
    });
  });

  it('converts mention inline content to plain text with @ prefix', () => {
    const blocknote = [
      {
        type: 'paragraph',
        props: {},
        content: [
          {
            type: 'mention',
            label: 'Alice',
          },
        ],
      },
    ];

    expect(blockNoteJsonToProsemirrorJson(blocknote)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '@Alice' }],
        },
      ],
    });
  });

  it('converts code blocks to ProseMirror code_block nodes', () => {
    const blocknote = [
      {
        type: 'codeBlock',
        props: {},
        content: [{ type: 'text', text: 'const x = 1;', styles: {} }],
      },
    ];

    expect(blockNoteJsonToProsemirrorJson(blocknote)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'code_block',
          content: [{ type: 'text', text: 'const x = 1;' }],
        },
      ],
    });
  });

  it('converts blockquotes to ProseMirror blockquote nodes', () => {
    const blocknote = [
      {
        type: 'blockquote',
        props: {},
        content: [{ type: 'text', text: 'Quoted', styles: {} }],
      },
    ];

    expect(blockNoteJsonToProsemirrorJson(blocknote)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Quoted' }],
            },
          ],
        },
      ],
    });
  });

  it('handles empty blocks without crashing', () => {
    const blocknote = [
      {
        type: 'paragraph',
        props: {},
        content: [],
      },
    ];

    expect(blockNoteJsonToProsemirrorJson(blocknote)).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
  });
});
