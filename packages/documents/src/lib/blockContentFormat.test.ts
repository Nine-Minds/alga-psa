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
});
