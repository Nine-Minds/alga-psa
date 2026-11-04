import { describe, expect, it } from 'vitest';
import { hasDescriptionContent } from './descriptionContent';

describe('hasDescriptionContent', () => {
  it('treats a parsed-but-empty description as empty', () => {
    expect(hasDescriptionContent([])).toBe(false);
    expect(hasDescriptionContent([{ type: 'paragraph', content: [] }])).toBe(false);
    expect(hasDescriptionContent([{ type: 'paragraph', content: [{ type: 'text', text: '' }] }])).toBe(false);
    expect(hasDescriptionContent([{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }])).toBe(false);
  });

  it('counts real text, including nested blocks', () => {
    expect(hasDescriptionContent([{ type: 'paragraph', content: [{ type: 'text', text: 'Printer offline' }] }])).toBe(true);
    expect(
      hasDescriptionContent([
        { type: 'paragraph', content: [] },
        { type: 'bulletListItem', content: [{ type: 'text', text: 'step one' }] },
      ]),
    ).toBe(true);
  });

  it('counts a non-text block such as an image', () => {
    expect(hasDescriptionContent([{ type: 'image', props: { url: 'https://example.test/a.png' } }])).toBe(true);
  });
});
