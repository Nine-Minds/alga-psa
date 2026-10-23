import { describe, expect, it } from 'vitest';
import { convertHtmlToBlockNote } from '../contentConversion';

// Outlook-style shapes from ticket alga-2026-0002751: BlockNote's HTML parser
// folds trailing `<br><br>` into the preceding text node — inside the link's
// own text when the breaks sit next to an anchor. Stored like that, the link
// swallows whatever follows it when the comment is rendered again.
const LINK = 'https://example.com/x';

function inlineItems(blocks: any[]): any[] {
  return blocks.flatMap((block) => (Array.isArray(block.content) ? block.content : []));
}

function textNodes(blocks: any[]): any[] {
  return inlineItems(blocks).flatMap((item: any) =>
    item?.type === 'link' && Array.isArray(item.content) ? item.content : [item],
  );
}

function lineText(block: any): string {
  const content = Array.isArray(block.content) ? block.content : [];
  return content
    .map((item: any) =>
      item?.type === 'link' && Array.isArray(item.content)
        ? item.content.map((c: any) => c.text ?? '').join('')
        : item?.text ?? '',
    )
    .join('');
}

describe('convertHtmlToBlockNote newline normalization', () => {
  it('splits breaks folded into the link text (<a>url<br><br></a>text)', async () => {
    const blocks = await convertHtmlToBlockNote(`<p><a href="${LINK}">${LINK}<br><br></a>next text</p>`);

    expect(textNodes(blocks).every((node: any) => !(node.text ?? '').includes('\n'))).toBe(true);
    expect(blocks.map(lineText)).toEqual([LINK, '', 'next text']);
    const links = inlineItems(blocks).filter((item: any) => item.type === 'link');
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe(LINK);
    // The link ends its own paragraph; the following text is a separate block.
    expect(inlineItems([blocks[0]])).toHaveLength(1);
  });

  it('splits breaks that follow the anchor (<a>url</a><br><br>text)', async () => {
    const blocks = await convertHtmlToBlockNote(`<p><a href="${LINK}">${LINK}</a><br><br>next text</p>`);

    expect(textNodes(blocks).every((node: any) => !(node.text ?? '').includes('\n'))).toBe(true);
    expect(blocks.map(lineText)).toEqual([LINK, '', 'next text']);
    const links = inlineItems(blocks).filter((item: any) => item.type === 'link');
    expect(links.map((l: any) => l.href)).toEqual([LINK]);
    expect(inlineItems([blocks[0]])).toHaveLength(1);
  });

  it('splits breaks inside a labelled link (<a><span>label</span><br><br></a>)', async () => {
    const blocks = await convertHtmlToBlockNote(`<p><a href="${LINK}"><span>Ticket link</span><br><br></a></p>`);

    expect(textNodes(blocks).every((node: any) => !(node.text ?? '').includes('\n'))).toBe(true);
    expect(blocks.map(lineText)).toEqual(['Ticket link', '', '']);
    const links = inlineItems(blocks).filter((item: any) => item.type === 'link');
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe(LINK);
    expect(links[0].content[0].text).toBe('Ticket link');
  });

  it('splits breaks folded into a plain text node', async () => {
    const blocks = await convertHtmlToBlockNote(`<p>See ${LINK}<br><br>more</p>`);

    expect(textNodes(blocks).every((node: any) => !(node.text ?? '').includes('\n'))).toBe(true);
    expect(blocks.map(lineText)).toEqual([`See ${LINK}`, '', 'more']);
    expect(blocks.every((block) => block.type === 'paragraph')).toBe(true);
  });
});
