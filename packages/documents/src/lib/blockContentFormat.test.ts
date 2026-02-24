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
});
