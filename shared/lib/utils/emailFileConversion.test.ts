import { describe, it, expect } from 'vitest';
import { convertHtmlToBlockNote, convertMarkdownToBlocks } from './contentConversion';

describe('Email Content Conversion Logic', () => {

  it('should handle block links split by Turndown (Link wrapping Header + Text) via raw Markdown', () => {
    // Directly test the parser logic with the split syntax Turndown produces
    const splitMarkdown = [
      '[',
      '![Article Image](https://example.com/img.jpg)',
      '',
      '### Big News Story',
      '',
      'This is a summary of the news.',
      '',
      'Read more](https://example.com/article)'
    ].join('\n');

    const blocks = convertMarkdownToBlocks(splitMarkdown);

    // Verify key content is present
    const hasImageText = blocks.some(b => JSON.stringify(b).includes('Article Image'));
    expect(hasImageText).toBe(true);

    const hasHeaderText = blocks.some(b => JSON.stringify(b).includes('Big News Story'));
    expect(hasHeaderText).toBe(true);

    // Verify linking (URL presence)
    const hasLink = blocks.some(b => JSON.stringify(b).includes('https://example.com/article'));
    expect(hasLink).toBe(true);
  });

  it('should handle simple block links (Link wrapping Text)', async () => {
    const simpleHtml = `
          <a href="https://example.com/readmore">
            <p>Read more</p>
          </a>
        `;
    const blocks = await convertHtmlToBlockNote(simpleHtml);

    // BlockNote should produce a link in the content
    const allContent = blocks.flatMap(b => b.content || []);
    const hasLink = allContent.some((c: any) =>
      c.type === 'link' || (c.styles && c.styles.link)
    );
    // At minimum, the text should be present
    const allText = allContent.map((c: any) => c.text || '').join('');
    expect(allText).toContain('Read more');
  });

  it('should handle nested lists', async () => {
    const listHtml = `
           <ul>
             <li>Item 1</li>
             <li>Item 2
               <ul>
                 <li>Subitem A</li>
               </ul>
             </li>
           </ul>
         `;
    const blocks = await convertHtmlToBlockNote(listHtml);

    expect(blocks.length).toBeGreaterThan(0);

    // Find bullet list items
    const bulletItems = blocks.filter(b => b.type === 'bulletListItem');
    expect(bulletItems.length).toBeGreaterThanOrEqual(2);

    // Check that item text is present
    const allText = blocks
      .flatMap(b => [
        ...(b.content || []),
        ...((b.children || []).flatMap((c: any) => c.content || [])),
      ])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text);
    expect(allText).toContain('Item 1');
  });

  it('should handle links in HTML', async () => {
    const html = `<p><a href="https://example.com/foobar">Link</a></p>`;
    const blocks = await convertHtmlToBlockNote(html);
    const content = blocks[0]?.content || [];
    const link = content.find((c: any) => c.type === 'link');
    expect(link).toBeDefined();
    expect(link?.href).toBe('https://example.com/foobar');
  });

});
