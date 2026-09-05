import { describe, expect, it } from 'vitest';
import { prosemirrorToMarkdown } from './RichTextViewer';

describe('prosemirrorToMarkdown images', () => {
  it('emits markdown image syntax so the re-parse keeps the picture', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        {
          type: 'image',
          attrs: { src: 'https://example.com/a.png', alt: 'A diagram', title: 'A diagram' },
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
      ],
    };

    expect(prosemirrorToMarkdown(doc)).toBe(
      'Before\n\n![A diagram](https://example.com/a.png)\n\nAfter'
    );
  });

  it('reads BlockNote-shaped image props and falls back to an empty alt', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'image', props: { url: 'https://example.com/b.png', caption: 'Queue' } },
        { type: 'image', attrs: { src: 'https://example.com/c.png' } },
      ],
    };

    expect(prosemirrorToMarkdown(doc)).toBe(
      '![Queue](https://example.com/b.png)\n\n![](https://example.com/c.png)'
    );
  });

  it('skips an image node with no source', () => {
    const doc = { type: 'doc', content: [{ type: 'image', attrs: { alt: 'broken' } }] };
    expect(prosemirrorToMarkdown(doc)).toBe('');
  });
});
