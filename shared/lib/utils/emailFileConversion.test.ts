import { describe, it, expect } from 'vitest';
import { convertHtmlToBlockNote } from './contentConversion';

// Helper to simulate QP decoding for tests if needed, though mostly we test logic now
function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=[ \t]*(?:\r\n|\r|\n)/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

describe('Email Content Conversion Logic', () => {
  
  it('should handle block links split by Turndown (Link wrapping Header + Text)', () => {
    // Simulating Turndown output for: <a href="..."><img ...><h3>Header</h3><p>Text</p></a>
    // Turndown often splits this into:
    // [
    // ![Alt](imgUrl)
    // ### Header
    // Text](linkUrl)
    
    const complexHtml = `
      <a href="https://example.com/article">
        <img src="https://example.com/img.jpg" alt="Article Image" />
        <h3>Big News Story</h3>
        <p>This is a summary of the news.</p>
        <span>Read more</span>
      </a>
    `;
    
    const blocks = convertHtmlToBlockNote(complexHtml);
    
    // Verify structure
    // We expect the content to be preserved and linked.
    
    // 1. Image should be linked (or at least present)
    const imageBlock = blocks.find(b => b.type === 'image');
    expect(imageBlock).toBeDefined();
    expect(imageBlock?.props?.name).toBe('Article Image');
    
    // 2. Heading should be linked
    const headingBlock = blocks.find(b => b.type === 'heading');
    expect(headingBlock).toBeDefined();
    expect(headingBlock?.content?.[0]?.type).toBe('link');
    expect(headingBlock?.content?.[0]?.href).toBe('https://example.com/article');
    expect(headingBlock?.content?.[0]?.content?.[0]?.text).toBe('Big News Story');

    // 3. Paragraph should be linked
    const pBlock = blocks.find(b => b.type === 'paragraph' && b.content?.some(c => c.content?.[0]?.text === 'This is a summary of the news.'));
    expect(pBlock).toBeDefined();
    // Check link
    const pLink = pBlock?.content?.find(c => c.type === 'link');
    expect(pLink?.href).toBe('https://example.com/article');
  });

  it('should handle simple block links (Link wrapping Text)', () => {
    const simpleHtml = `
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
     expect(blocks.length).toBeGreaterThan(0);
     const item1 = blocks.find(b => b.content?.[0]?.text === 'Item 1');
     expect(item1?.type).toBe('bulletListItem');
     
     // Turndown flatterns lists or handles them via indentation in Markdown.
     // Our parser needs to handle indentation if Turndown produces it.
     // Standard Turndown produces:
     // - Item 1
     // - Item 2
     //   - Subitem A
     
     // Our current convertMarkdownToBlocks handles lines starting with `*` or `-`.
     // It does NOT currently handle indentation for nesting levels in the loop explicitly 
     // (it creates flat list items).
     // BlockNote supports nesting via `children`.
     // This might be a limitation of our current simple parser, but let's verify what happens.
     // Likely they all become top-level bulletListItems.
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