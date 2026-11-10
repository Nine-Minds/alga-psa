import { describe, expect, it, vi } from 'vitest';
import {
  convertBlockContentToHTML,
  convertBlockContentToMarkdown,
  flattenBlockContentToPlainText,
  formatBlockNoteContent,
  UNSUPPORTED_RICH_TEXT_PLACEHOLDER,
} from './blocknoteUtils';

const text = (value: string) => [{ type: 'text', text: value, styles: {} }];
const cell = (value: string) => ({ type: 'tableCell', content: text(value) });

describe('rich-text export structures', () => {
  it.each(['current', 'legacy'] as const)('preserves %s table cells in HTML, text and serialized content', (format) => {
    const values = [
      ['Data Transfer', '50gb'],
      ['Data Backup Type', 'Backup type to set up / install'],
      ['Virus Protection', 'AV to install; transferred from old machine or purchased'],
      ['Software to Install', 'Approved software or "none"'],
      ['Hardware to Install', 'New hardware approved or "none"'],
    ];
    const blocks = [{
      type: 'table',
      content: { type: 'tableContent', rows: values.map(row => ({
        cells: row.map(value => format === 'current' ? cell(value) : text(value)),
      })) },
    }];
    for (const content of [blocks, JSON.stringify(blocks)]) {
      const { html, text: plainText } = formatBlockNoteContent(content);
      expect(html).toContain('border-collapse:collapse');
      expect(html.match(/<tr>/g)).toHaveLength(5);
      expect(html.match(/<td\b/g)).toHaveLength(10);
      for (const row of values) {
        for (const value of row) {
          expect(flattenBlockContentToPlainText(content)).toContain(value);
          expect(plainText).toContain(value);
        }
      }
      expect(html).toContain('50gb');
      expect(html).toContain('Approved software or &quot;none&quot;');
    }
  });

  it('preserves header cells, spans, alignment, inline formatting and safe links', () => {
    const html = convertBlockContentToHTML([{
      type: 'table',
      content: {
        type: 'tableContent',
        headerRows: 1,
        rows: [{ cells: [{
          type: 'tableCell',
          props: { colspan: 2, rowspan: 2, textAlignment: 'right' },
          content: [
            { type: 'text', text: '<script>', styles: { bold: true } },
            { type: 'link', href: 'javascript:alert(1)', content: text('Unsafe') },
            { type: 'link', href: 'https://example.com', content: text('Safe') },
          ],
        }] }],
      },
    }]);
    expect(html).toContain('<th colspan="2" rowspan="2"');
    expect(html).toContain('text-align:right');
    expect(html).toContain('<strong>&lt;script&gt;</strong>');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('javascript:');
  });

  it('preserves headings, nested lists, completed tasks, quotes, toggles, code and dividers', () => {
    const blocks = [
      { type: 'heading', props: { level: 2 }, content: text('Setup Requirements') },
      { type: 'bulletListItem', content: text('Parent'), children: [
        { type: 'numberedListItem', content: text('Nested step') },
      ] },
      { type: 'checkListItem', props: { checked: true }, content: text('Wi-Fi') },
      { type: 'checkListItem', props: { checked: false }, content: text('Ethernet') },
      { type: 'quote', content: text('Quoted details') },
      { type: 'toggleListItem', content: text('More details'), children: [
        { type: 'paragraph', content: text('Expanded child content') },
      ] },
      { type: 'codeBlock', props: { language: 'sh' }, content: text('echo <safe>') },
      { type: 'divider' },
    ];
    const { html, text: plainText } = formatBlockNoteContent(blocks);
    expect(html).toContain('<h2>Setup Requirements</h2>');
    expect(html).toContain('<ul><li>Parent<ol><li>Nested step</li></ol></li></ul>');
    expect(html).toContain('&#9745;');
    expect(html).toContain('<s>Wi-Fi</s>');
    expect(html).toContain('&#9744;');
    expect(html).not.toContain('<s>Ethernet</s>');
    expect(html).toContain('<blockquote>Quoted details');
    expect(html).toContain('Expanded child content');
    expect(html).toContain('echo &lt;safe&gt;');
    expect(html).toContain('<hr>');
    expect(plainText).toContain('Nested step');
    expect(plainText).toContain('- [x] Wi-Fi');
    expect(plainText).toContain('- [ ] Ethernet');
    expect(plainText).toContain('Expanded child content');
  });

  it('preserves code token boundaries and authored line breaks without inline markup', () => {
    const content = [
      { type: 'text', text: 'const ', styles: {} },
      { type: 'text', text: 'value', styles: { bold: true } },
      { type: 'text', text: ' = 1;\nreturn value;', styles: {} },
    ];
    for (const input of [
      [{ type: 'codeBlock', content }],
      { type: 'doc', content: [{ type: 'code_block', content }] },
    ]) {
      const formatted = formatBlockNoteContent(input);
      expect(formatted.html).toContain('const value = 1;\nreturn value;');
      expect(formatted.text).toContain('const value = 1;\nreturn value;');
      expect(formatted.text).not.toContain('**value**');
    }
  });

  it.each(['video', 'audio', 'file', 'embed'])('exports %s as a safe, non-executable link', (type) => {
    const content = [{ type, props: { url: 'https://example.com/media', name: '<Media>' } }];
    const { html, text: plainText } = formatBlockNoteContent(content);
    expect(html).toContain('href="https://example.com/media"');
    expect(html).toContain('&lt;Media&gt;');
    expect(html).not.toMatch(/<(?:iframe|video|audio|embed)\b/);
    expect(plainText).toBe('[<Media>](https://example.com/media)');
  });

  it.each([
    [{ type: 'unsupportedWidget' }],
    [{ type: 'embed', props: { url: 'javascript:alert(1)' } }],
    [{ type: 'table', content: { rows: [{ cells: [{ invalid: true }] }] } }],
  ])('replaces unsupported content with a visible placeholder instead of failing or dropping it: %j', (block) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const content = [{ type: 'paragraph', content: [{ type: 'text', text: 'Before', styles: {} }] }, block];
    for (const value of [content, JSON.stringify(content)]) {
      const { html, text: plainText } = formatBlockNoteContent(value);
      const markdown = convertBlockContentToMarkdown(value);
      for (const output of [html, plainText, markdown]) {
        expect(output).toContain('Before');
        expect(output).toContain(UNSUPPORTED_RICH_TEXT_PLACEHOLDER);
        expect(output).not.toContain('javascript:');
      }
    }
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('formats ProseMirror table cells, hard breaks, images and task states in notifications', () => {
    const content = {
      type: 'doc',
      content: [
        { type: 'table', content: [{ type: 'tableRow', content: [
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Requirement' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [
            { type: 'text', text: '50gb', marks: [{ type: 'bold' }] },
            { type: 'hardBreak' },
            { type: 'text', text: 'backup' },
          ] }] },
        ] }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Done' }] },
        ] }] },
        { type: 'image', attrs: { src: 'https://example.com/image.png', alt: 'Screenshot' } },
      ],
    };
    for (const value of [content, JSON.stringify(content)]) {
      const { html, text: plainText } = formatBlockNoteContent(value);
      expect(html).toMatch(/<th\b[^>]*><p[^>]*>Requirement/);
      expect(html).toContain('<strong>50gb</strong><br>backup');
      expect(html).toMatch(/<s><p[^>]*>Done<\/p><\/s>/);
      expect(html).toContain('<img src="https://example.com/image.png"');
      expect(plainText).toContain('Requirement');
      expect(plainText).toContain('**50gb**');
      expect(plainText).toContain('- [x] Done');
    }
  });
});
