import { detectBlockContentFormat } from './blockContentFormat';

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
});
