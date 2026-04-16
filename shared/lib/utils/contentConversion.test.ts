import { describe, it, expect } from 'vitest';
import { convertHtmlToBlockNote, convertMarkdownToBlocks } from './contentConversion';

describe('convertHtmlToBlockNote', () => {
  it('should handle empty input', async () => {
    expect(await convertHtmlToBlockNote('')).toEqual([]);
    // @ts-ignore
    expect(await convertHtmlToBlockNote(null)).toEqual([]);
    // @ts-ignore
    expect(await convertHtmlToBlockNote(undefined)).toEqual([]);
  });

  it('should convert simple paragraphs', async () => {
    const html = '<p>Hello World</p>';
    const result = await convertHtmlToBlockNote(html);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('paragraph');
    const text = result[0].content?.find((c: any) => c.type === 'text');
    expect(text?.text).toBe('Hello World');
  });

  it('should convert headings', async () => {
    const html = '<h1>Title 1</h1><h2>Title 2</h2><h3>Title 3</h3>';
    const result = await convertHtmlToBlockNote(html);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ type: 'heading', props: expect.objectContaining({ level: 1 }) });
    expect(result[1]).toMatchObject({ type: 'heading', props: expect.objectContaining({ level: 2 }) });
    expect(result[2]).toMatchObject({ type: 'heading', props: expect.objectContaining({ level: 3 }) });
  });

  it('should convert lists', async () => {
    const html = `
      <ul><li>Item 1</li><li>Item 2</li></ul>
      <ol><li>Ordered 1</li><li>Ordered 2</li></ol>
    `;
    const result = await convertHtmlToBlockNote(html);
    expect(result.length).toBeGreaterThanOrEqual(4);

    const bulletItem = result.find(b => b.type === 'bulletListItem');
    const numberedItem = result.find(b => b.type === 'numberedListItem');

    expect(bulletItem).toBeDefined();
    expect(numberedItem).toBeDefined();
  });

  it('should handle inline styles (bold, italic)', async () => {
    const html = '<p><strong>Bold</strong> and <em>Italic</em></p>';
    const result = await convertHtmlToBlockNote(html);

    const paragraph = result[0];
    const content = paragraph.content || [];

    const boldSegment = content.find((c: any) => c.text === 'Bold');
    expect(boldSegment?.styles).toMatchObject({ bold: true });

    const italicSegment = content.find((c: any) => c.text === 'Italic');
    expect(italicSegment?.styles).toMatchObject({ italic: true });
  });

  it('should handle links', async () => {
    const html = '<p>Click <a href="https://example.com">here</a></p>';
    const result = await convertHtmlToBlockNote(html);

    const content = result[0].content || [];
    const linkSegment = content.find((c: any) => c.type === 'link');
    expect(linkSegment).toBeDefined();
    expect(linkSegment?.href).toBe('https://example.com');
  });

  it('should convert standalone images to image blocks', async () => {
    const html = '<p><img src="https://example.com/image.png" alt="My Image" /></p>';
    const result = await convertHtmlToBlockNote(html);

    const imageBlock = result.find(b => b.type === 'image');
    expect(imageBlock).toBeDefined();
    expect(imageBlock?.props?.url).toBe('https://example.com/image.png');
  });

  it('should strip Outlook style tags and comments', async () => {
    const html = `
      <html><head>
      <style>p.MsoNormal{font-size:12pt;font-family:Aptos;}</style>
      </head><body>
      <!-- /* Font Definitions */ @font-face {font-family:Helvetica;} -->
      <p class="MsoNormal">Actual content</p>
      </body></html>
    `;
    const result = await convertHtmlToBlockNote(html);

    // Should contain the paragraph with actual content
    const paragraph = result.find(b => b.type === 'paragraph');
    expect(paragraph).toBeDefined();
    const text = paragraph?.content?.find((c: any) => c.type === 'text');
    expect(text?.text).toContain('Actual content');

    // Should NOT contain CSS text
    const allText = result
      .flatMap(b => (b.content || []))
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join(' ');
    expect(allText).not.toContain('font-family');
    expect(allText).not.toContain('MsoNormal');
    expect(allText).not.toContain('@font-face');
  });

  it('should strip Outlook conditional comments with CSS inside style tags', async () => {
    // Outlook/Word emails wrap CSS in <!--[if ...]> ... <![endif]--> and
    // also use <!-- ... --> inside <style> tags
    const html = `
      <html><head>
      <!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]-->
      <!--[if !mso]><style>v\\:* {behavior:url(#default#VML);}</style><![endif]-->
      <style>
      <!--
       /* Font Definitions */
       @font-face {font-family:"Cambria Math"; panose-1:2 4 5 3 5 4 6 3 2 4;}
       @font-face {font-family:Calibri; panose-1:2 15 5 2 2 2 4 3 2 4;}
       /* Style Definitions */
       p.MsoNormal, li.MsoNormal, div.MsoNormal {margin:0in; font-size:11.0pt; font-family:"Calibri",sans-serif; color:windowtext;}
       span.EmailStyle17 {mso-style-type:personal-compose; font-family:"Calibri",sans-serif;}
      -->
      </style>
      </head><body>
      <div class=WordSection1>
      <p class=MsoNormal>Hello from Outlook</p>
      </div>
      </body></html>
    `;
    const result = await convertHtmlToBlockNote(html);

    const allText = result
      .flatMap(b => (b.content || []))
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join(' ');
    expect(allText).toContain('Hello from Outlook');
    expect(allText).not.toContain('font-family');
    expect(allText).not.toContain('@font-face');
    expect(allText).not.toContain('Cambria Math');
    expect(allText).not.toContain('MsoNormal');
    expect(allText).not.toContain('OfficeDocumentSettings');
  });

  it('should strip Outlook conditional PIs without comment markers', async () => {
    // Some Outlook emails use <![if ...]>...<![endif]> without -- prefix
    const html = `
      <html><head>
      <![if !supportMisalignedColumns]>
      <style>
       .MsoTableGrid { border-collapse:collapse; }
      </style>
      <![endif]>
      </head><body>
      <p>Content after PI</p>
      </body></html>
    `;
    const result = await convertHtmlToBlockNote(html);

    const allText = result
      .flatMap(b => (b.content || []))
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join(' ');
    expect(allText).toContain('Content after PI');
    expect(allText).not.toContain('MsoTableGrid');
    expect(allText).not.toContain('border-collapse');
  });

  it('should parse HTML tables into table blocks', async () => {
    const html = `
      <table border="1">
        <tr><th></th><th>Column 1</th><th>Column 2</th><th>Column3</th></tr>
        <tr><td>Row 1</td><td>some</td><td>text</td><td>to</td></tr>
        <tr><td>Row 2</td><td>fill</td><td>in</td><td>cells</td></tr>
      </table>
    `;
    const result = await convertHtmlToBlockNote(html);

    const tableBlock = result.find(b => b.type === 'table');
    expect(tableBlock).toBeDefined();

    // Table should have structured content, not flat text
    const content = tableBlock?.content as any;
    expect(content).toBeDefined();
    expect(content.rows).toBeDefined();
    expect(content.rows.length).toBeGreaterThanOrEqual(2);
  });
});

describe('convertMarkdownToBlocks', () => {
  it('should handle images split across lines (wrapped markdown)', () => {
    const markdown = '![Ad]\n(https://example.com/long-url)';
    const result = convertMarkdownToBlocks(markdown);

    const imageBlock = result.find(b => b.type === 'image');
    expect(imageBlock).toBeDefined();
    expect(imageBlock?.props?.url).toBe('https://example.com/long-url');
    expect(imageBlock?.props?.name).toBe('Ad');
  });
});
