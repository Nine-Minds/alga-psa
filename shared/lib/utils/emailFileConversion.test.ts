import { describe, it, expect } from 'vitest';
import { convertHtmlToBlockNote, convertMarkdownToBlocks } from './contentConversion';

// Helper to simulate QP decoding for tests if needed, though mostly we test logic now
function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=[ \t]*(?:\r\n|\r|\n)/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

describe('Email Content Conversion Logic', () => {
  
  it('should handle block links split by Turndown (Link wrapping Header + Text) via raw Markdown', () => {
    // Directly test the parser logic with the split syntax Turndown produces
    // We use an array join to ensure no hidden indentation issues from template literals
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

  it('should handle simple block links (Link wrapping Text)', () => {        const simpleHtml = `
          <a href="https://example.com/readmore">
            <p>Read more</p>
          </a>
        `;
        // Turndown might output: [Read more](...) or just standard link if it's simple.
        // If it outputs split syntax, our parser handles it.
        
        const blocks = convertHtmlToBlockNote(simpleHtml);
        const linkBlock = blocks.find(b => b.content?.some(c => c.type === 'link' && c.content?.[0]?.text === 'Read more'));
        expect(linkBlock).toBeDefined();
        expect(linkBlock?.content?.[0]?.href).toBe('https://example.com/readmore');
      });
    
      it('should handle nested lists', () => {
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
         const blocks = convertHtmlToBlockNote(listHtml);
         // console.log('Nested List Blocks:', JSON.stringify(blocks, null, 2));
         
         expect(blocks.length).toBeGreaterThan(0);
         const item1 = blocks.find(b => b.content?.[0]?.text === 'Item 1');
         expect(item1?.type).toBe('bulletListItem');
         
         const subitem = blocks.find(b => b.content?.[0]?.text === 'Subitem A');
         expect(subitem).toBeDefined();
         expect(subitem?.type).toBe('bulletListItem');
      });
  it('should strip newlines from hrefs', () => {
    const messyHtml = `<a href="https://example.com/foo\nbar">Link</a>`;
    const blocks = convertHtmlToBlockNote(messyHtml);
    const link = blocks[0]?.content?.[0];
    expect(link?.href).toBe('https://example.com/foobar');
  });

});