import { describe, expect, it } from 'vitest';

import { convertBlockNoteToHTML } from './blocknoteUtils';

describe('blocknoteUtils convertBlockNoteToHTML', () => {
  it('escapes codeBlock content for HTML output', () => {
    const blocks = [
      {
        type: 'codeBlock',
        props: { language: 'ts' },
        content: [
          { type: 'text', text: 'if (a < b && b > c) return a & b;' },
        ],
      },
    ];

    const html = convertBlockNoteToHTML(blocks);
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
    expect(html).toContain('&amp;');
  });

  it('escapes default-case string content for HTML output', () => {
    const blocks = [
      {
        type: 'unknownBlock',
        content: 'a < b && b > c & "quote"',
      },
    ];

    const html = convertBlockNoteToHTML(blocks);
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });

  it('sanitizes codeBlock language to avoid attribute injection', () => {
    const blocks = [
      {
        type: 'codeBlock',
        props: { language: 'ts" onmouseover="alert(1)' },
        content: [{ type: 'text', text: 'const ok = true;' }],
      },
    ];

    const html = convertBlockNoteToHTML(blocks);
    expect(html).toContain('class="language-tsonmouseoveralert1"');
    expect(html).not.toContain('" onmouseover="');
  });
});
