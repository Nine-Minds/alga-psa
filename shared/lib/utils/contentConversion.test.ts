import { describe, it, expect } from 'vitest';
import { convertHtmlToBlockNote, convertMarkdownToBlocks } from './contentConversion';

describe('convertHtmlToBlockNote', () => {
  it('should handle empty input', () => {
    expect(convertHtmlToBlockNote('')).toEqual([]);
    // @ts-ignore
    expect(convertHtmlToBlockNote(null)).toEqual([]);
    // @ts-ignore
    expect(convertHtmlToBlockNote(undefined)).toEqual([]);
  });

  it('should convert simple paragraphs', () => {
    const html = '<p>Hello World</p>';
    const result = convertHtmlToBlockNote(html);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('paragraph');
    expect(result[0].content).toEqual([{ type: 'text', text: 'Hello World', styles: {} }]);
  });

  it('should convert headings', () => {
    const html = '<h1>Title 1</h1><h2>Title 2</h2><h3>Title 3</h3>';
    const result = convertHtmlToBlockNote(html);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ type: 'heading', props: { level: 1 } });
    expect(result[1]).toMatchObject({ type: 'heading', props: { level: 2 } });
    expect(result[2]).toMatchObject({ type: 'heading', props: { level: 3 } });
  });

  it('should convert lists', () => {
    const html = `
      <ul><li>Item 1</li><li>Item 2</li></ul>
      <ol><li>Ordered 1</li><li>Ordered 2</li></ol>
    `;
    const result = convertHtmlToBlockNote(html);
    // Turndown usually puts lists on new lines
    expect(result.length).toBeGreaterThanOrEqual(4);
    
    const bulletItem = result.find(b => b.type === 'bulletListItem');
    const numberedItem = result.find(b => b.type === 'numberedListItem');
    
    expect(bulletItem).toBeDefined();
    expect(numberedItem).toBeDefined();
  });

  it('should convert code blocks', () => {
    const html = '<pre><code class="language-javascript">console.log("hi");</code></pre>';
    const result = convertHtmlToBlockNote(html);
    
    const codeBlock = result.find(b => b.type === 'codeBlock');
    expect(codeBlock).toBeDefined();
    expect(codeBlock?.props?.language).toBe('javascript');
    expect(codeBlock?.content?.[0]?.text).toContain('console.log');
  });

  it('should handle inline styles (bold, italic)', () => {
    const html = '<p><strong>Bold</strong> and <em>Italic</em> and <strong><em>Both</em></strong></p>';
    const result = convertHtmlToBlockNote(html);
    
    const paragraph = result[0];
    const content = paragraph.content || [];
    
    // Note: Turndown might convert <strong> to ** and <em> to * or _
    // Our regex handles ** and *
    
    // We expect segments. Exact splitting depends on the regex parser implementation
    const boldSegment = content.find(c => c.text === 'Bold');
    expect(boldSegment?.styles).toMatchObject({ bold: true });

    const italicSegment = content.find(c => c.text === 'Italic');
    expect(italicSegment?.styles).toMatchObject({ italic: true });

    const bothSegment = content.find(c => c.text === 'Both');
    expect(bothSegment?.styles).toMatchObject({ bold: true, italic: true });
  });

  it('should handle links', () => {
    const html = '<p>Click <a href="https://example.com">here</a></p>';
    const result = convertHtmlToBlockNote(html);
    
    const linkBlock = result[0].content?.find(c => c.type === 'link');
    expect(linkBlock).toBeDefined();
    expect(linkBlock?.href).toBe('https://example.com');
    expect(linkBlock?.content?.[0]?.text).toBe('here');
  });

  it('should handle nested styles in links', () => {
    const html = '<p><a href="https://example.com"><strong>Bold Link</strong></a></p>';
    const result = convertHtmlToBlockNote(html);
    
    const linkBlock = result[0].content?.find(c => c.type === 'link');
    expect(linkBlock).toBeDefined();
    expect(linkBlock?.content?.[0]?.text).toBe('Bold Link');
    expect(linkBlock?.content?.[0]?.styles).toMatchObject({ bold: true });
  });

  it('should convert standalone images to image blocks', () => {
    const html = '<p><img src="https://example.com/image.png" alt="My Image" /></p>';
    const result = convertHtmlToBlockNote(html);
    
    const imageBlock = result.find(b => b.type === 'image');
    expect(imageBlock).toBeDefined();
    expect(imageBlock?.props?.url).toBe('https://example.com/image.png');
    expect(imageBlock?.props?.name).toBe('My Image');
  });

  it('should convert inline images to links with emoji', () => {
    const html = '<p>Text with <img src="https://example.com/icon.png" alt="icon" /> inline.</p>';
    const result = convertHtmlToBlockNote(html);
    
    const paragraph = result[0];
    const link = paragraph.content?.find(c => c.type === 'link');
    
    expect(link).toBeDefined();
    expect(link?.href).toBe('https://example.com/icon.png');
    // Check for emoji in content text
    expect(link?.content?.[0]?.text).toContain('🖼️');
    expect(link?.content?.[0]?.text).toContain('icon');
  });

  it('should handle images with mid-string parentheses in URL', () => {
    const html = '<p><img src="https://example.com/folder(1)/image.png" alt="Complex Image" /></p>';
    const result = convertHtmlToBlockNote(html);
    
    const imageBlock = result.find(b => b.type === 'image');
    expect(imageBlock).toBeDefined();
    expect(imageBlock?.props?.url).toBe('https://example.com/folder(1)/image.png');
  });

  it('should handle images split across lines (wrapped markdown)', () => {
    // Simulating hard-wrapped markdown where [Alt] and (Url) are on different lines
    // This often happens with very long URLs in some markdown generators or email processing
    const markdown = '![Ad]\n(https://example.com/long-url)';
    const result = convertMarkdownToBlocks(markdown);
    
    const imageBlock = result.find(b => b.type === 'image');
    expect(imageBlock).toBeDefined();
    expect(imageBlock?.props?.url).toBe('https://example.com/long-url');
    expect(imageBlock?.props?.name).toBe('Ad');
  });
});