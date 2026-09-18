import { describe, expect, it } from 'vitest';
import type { PartialBlock } from '@blocknote/core';
import { splitEmbeddedNewlineBlocks } from './normalizeBlocks';

const props = { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' } as const;

describe('splitEmbeddedNewlineBlocks', () => {
  it('splits a single paragraph carrying raw newlines into one block per line', () => {
    // Shape observed in production: a whole multi-line comment stored as one
    // text node with embedded "\n" characters.
    const blocks: PartialBlock[] = [
      {
        id: '86af5f90',
        type: 'paragraph',
        props,
        content: [{ type: 'text', text: '\nFirst line\nSecond line\nThird line', styles: {} }],
      } as PartialBlock,
    ];

    const result = splitEmbeddedNewlineBlocks(blocks);

    expect(result).toHaveLength(4);
    expect(result.every((b) => b.type === 'paragraph')).toBe(true);
    const texts = result.map((b) =>
      (b.content as any[]).map((i) => i.text ?? '').join('')
    );
    expect(texts).toEqual(['', 'First line', 'Second line', 'Third line']);
    // Props survive the split; ids do not (BlockNote assigns fresh ones).
    expect((result[1] as any).props).toEqual(props);
    expect((result[1] as any).id).toBeUndefined();
  });

  it('keeps non-text inline items (links, mentions) in their line segment', () => {
    const blocks: PartialBlock[] = [
      {
        type: 'paragraph',
        props,
        content: [
          { type: 'text', text: 'See ', styles: {} },
          { type: 'link', href: 'https://example.com', content: [{ type: 'text', text: 'docs', styles: {} }] },
          { type: 'text', text: '\nnext line', styles: {} },
        ],
      } as PartialBlock,
    ];

    const result = splitEmbeddedNewlineBlocks(blocks);
    expect(result).toHaveLength(2);
    expect((result[0].content as any[]).map((i: any) => i.type)).toEqual(['text', 'link']);
    expect((result[1].content as any[])[0].text).toBe('next line');
  });

  it('returns the same array untouched when no block needs splitting', () => {
    const blocks: PartialBlock[] = [
      { type: 'paragraph', props, content: [{ type: 'text', text: 'clean', styles: {} }] } as PartialBlock,
      { type: 'image', props: { url: 'x' } } as PartialBlock,
    ];
    expect(splitEmbeddedNewlineBlocks(blocks)).toBe(blocks);
  });

  it('leaves code blocks alone so intentional newlines survive', () => {
    const blocks: PartialBlock[] = [
      { type: 'codeBlock', content: [{ type: 'text', text: 'a\nb', styles: {} }] } as PartialBlock,
    ];
    expect(splitEmbeddedNewlineBlocks(blocks)).toBe(blocks);
  });
});
