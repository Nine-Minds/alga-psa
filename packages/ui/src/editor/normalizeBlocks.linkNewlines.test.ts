// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { splitEmbeddedNewlineBlocks } from './normalizeBlocks';

const props = { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' } as const;

// Shape from a pasted credential hand-off: labels as text, each URL as a link
// whose own text ends in blank lines. The top-level text items are clean, so
// only the link contents carry newlines.
const link = (n: number, trailing = '\n\n') => ({
  type: 'link',
  href: `https://example.com/send/${n}`,
  content: [{ type: 'text', text: `https://example.com/send/${n}${trailing}`, styles: {} }],
});

const pastedLinks: PartialBlock[] = [
  {
    id: 'b1',
    type: 'paragraph',
    props,
    content: [
      { type: 'text', text: 'A- ', styles: {} },
      link(1),
      { type: 'text', text: 'B- ', styles: {} },
      link(2),
      { type: 'text', text: 'C-', styles: {} },
      link(3),
    ],
    children: [],
  } as PartialBlock,
];

function mountReadOnly(blocks: PartialBlock[]) {
  const editor = BlockNoteEditor.create({ initialContent: blocks, trailingBlock: false });
  const host = document.createElement('div');
  document.body.appendChild(host);
  editor.mount(host);
  editor.isEditable = false;
  const outers = Array.from(host.querySelectorAll('.bn-block-outer'));
  const unmount = () => {
    editor.unmount();
    host.remove();
  };
  return { outers, unmount };
}

describe('splitEmbeddedNewlineBlocks with newlines inside link text', () => {
  it('splits the paragraph at the link newlines and keeps each URL a link', () => {
    const result = splitEmbeddedNewlineBlocks(pastedLinks);

    const lines = result.map((b) =>
      (b.content as any[]).map((i) => (i.type === 'link' ? `[${i.content[0].text}]` : i.text)).join('')
    );
    expect(lines).toEqual([
      'A- [https://example.com/send/1]',
      '',
      'B- [https://example.com/send/2]',
      '',
      'C-[https://example.com/send/3]',
      '',
      '',
    ]);
    const links = result.flatMap((b) => (b.content as any[]).filter((i) => i.type === 'link'));
    expect(links.map((l) => l.href)).toEqual([
      'https://example.com/send/1',
      'https://example.com/send/2',
      'https://example.com/send/3',
    ]);
    expect(links.every((l) => !l.content[0].text.includes('\n'))).toBe(true);
  });

  it('leaves links whose text has no newline untouched', () => {
    const clean: PartialBlock[] = [
      { type: 'paragraph', props, content: [{ type: 'text', text: 'See ', styles: {} }, link(1, '')] } as PartialBlock,
    ];
    expect(splitEmbeddedNewlineBlocks(clean)).toBe(clean);
  });

  it('renders without a trailing-break marker on the last block once split', () => {
    // Before the split, ProseMirror flagged the single block with its
    // trailing-break <br> (last text ended in "\n"), and the compact comment
    // CSS hid the whole note. Both halves of that failure are gone now.
    const before = mountReadOnly(pastedLinks);
    expect(before.outers).toHaveLength(1);
    expect(before.outers[0].querySelector('br.ProseMirror-trailingBreak')).not.toBeNull();
    before.unmount();

    const after = mountReadOnly(splitEmbeddedNewlineBlocks(pastedLinks));
    const linkBlocks = after.outers.filter((o) => o.querySelector('a'));
    expect(linkBlocks.map((o) => o.textContent)).toEqual([
      'A- https://example.com/send/1',
      'B- https://example.com/send/2',
      'C-https://example.com/send/3',
    ]);
    // Only genuinely empty blocks carry the marker; the content blocks do not.
    expect(linkBlocks.every((o) => o.querySelector('br.ProseMirror-trailingBreak') === null)).toBe(true);
    after.unmount();
  });
});
