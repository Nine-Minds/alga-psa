import { describe, expect, it } from 'vitest';
import { convertBlockNoteToHTML, convertBlockNoteToMarkdown } from './blocknoteUtils';

describe('blocknoteUtils image conversion', () => {
  it('converts image blocks to markdown and HTML output', () => {
    const blocks = [
      {
        type: 'image',
        props: {
          url: '/api/documents/view/file-123',
          name: 'clipboard-image.png',
          caption: 'Screenshot',
        },
      },
    ];

    const markdown = convertBlockNoteToMarkdown(blocks);
    const html = convertBlockNoteToHTML(blocks);

    expect(markdown).toContain('![Screenshot](/api/documents/view/file-123)');
    expect(html).toContain('<img src="/api/documents/view/file-123"');
    expect(html).toContain('figcaption');
  });

  it('T011: keeps non-image serialization behavior unchanged', () => {
    const blocks = [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Hello world', styles: {} }],
      },
    ];

    const markdown = convertBlockNoteToMarkdown(blocks);
    const html = convertBlockNoteToHTML(blocks);

    expect(markdown.trim()).toBe('Hello world');
    expect(html).toContain('<p');
    expect(html).toContain('Hello world');
  });
});
