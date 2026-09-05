// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { blocksToText } from 'server/src/lib/api/services/KbArticleService';

describe('KB article blocksToText', () => {
  it('renders image blocks as markdown so the content API is not lossy', () => {
    const markdown = blocksToText([
      { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Symptoms' }] },
      {
        type: 'image',
        props: { url: 'https://example.com/img/spooler.png', caption: 'Spooler dialog' },
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Restart the service.' }] },
    ]);

    expect(markdown).toBe(
      '## Symptoms\n![Spooler dialog](https://example.com/img/spooler.png)\nRestart the service.'
    );
  });

  it('accepts the ProseMirror-style src prop and a missing caption', () => {
    expect(blocksToText([{ type: 'image', props: { src: 'https://example.com/a.png' } }])).toBe(
      '![](https://example.com/a.png)'
    );
  });

  it('skips an image block with no url', () => {
    expect(blocksToText([{ type: 'image', props: { caption: 'no source' } }])).toBe('');
  });
});
