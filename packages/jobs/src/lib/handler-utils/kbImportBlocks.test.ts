import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  KbImportParseTimeoutError,
  fileContentToBlocks,
  htmlToBlocks,
  markdownToBlocks,
  titleFromFilename,
  type BlockNoteBlock,
  type InlineSegment,
  type TableContent,
} from './kbImportBlocks';

const fixture = (name: string): string =>
  readFileSync(resolve(__dirname, '__fixtures__/kbImport', name), 'utf8');

const inline = (block: BlockNoteBlock): InlineSegment[] => block.content as InlineSegment[];
const plainText = (block: BlockNoteBlock): string => inline(block).map((s) => s.text).join('');
const types = (blocks: BlockNoteBlock[]): string[] => blocks.map((b) => b.type);

describe('kbImportBlocks markdown fidelity', () => {
  const blocks = markdownToBlocks(fixture('full-article.md'));

  it('produces the golden BlockNote document', () => {
    expect(blocks).toMatchSnapshot();
  });

  it('maps every supported block construct', () => {
    expect(types(blocks)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'bulletListItem',
      'bulletListItem',
      'bulletListItem',
      'bulletListItem',
      'heading',
      'numberedListItem',
      'numberedListItem',
      'numberedListItem',
      'blockquote',
      'codeBlock',
      'codeBlock',
      'table',
      'horizontalRule',
      'paragraph',
    ]);
  });

  it('keeps heading levels and code-block languages in props', () => {
    expect(blocks[0].props).toEqual({ level: 1 });
    expect(blocks[2].props).toEqual({ level: 2 });
    expect(blocks[7].props).toEqual({ level: 3 });
    expect(blocks[12].props).toEqual({ language: 'powershell' });
    expect(blocks[13].props).toEqual({ language: 'plain' });
    expect(plainText(blocks[12])).toBe('Restart-Service -Name Spooler');
  });

  it('emits inline styled segments for bold, italic, code, links and strikethrough', () => {
    expect(inline(blocks[1])).toEqual([
      { type: 'text', text: 'Restart the ' },
      { type: 'text', text: 'spooler', styles: { bold: true } },
      { type: 'text', text: ' service, then ' },
      { type: 'text', text: 'retry', styles: { italic: true } },
      { type: 'text', text: ' the job. Run ' },
      { type: 'text', text: 'net stop spooler', styles: { code: true } },
      { type: 'text', text: ' and read the ' },
      { type: 'text', text: 'vendor guide', styles: { link: { href: 'https://example.com/printers' } } },
      { type: 'text', text: ' before escalating.' },
    ]);
    expect(inline(blocks[16])).toContainEqual({
      type: 'text',
      text: 'the helpdesk',
      styles: { strike: true },
    });
  });

  it('flattens nested list items into sibling item blocks', () => {
    expect(plainText(blocks[4])).toBe('Status shows offline');
    expect(plainText(blocks[5])).toBe('Only on the third floor');
    expect(blocks[5].type).toBe('bulletListItem');
  });

  it('collapses a multi-line blockquote into one block', () => {
    expect(plainText(blocks[11])).toBe(
      'Escalate to the vendor when the queue clears but printing still fails. Include the driver version.',
    );
  });

  it('builds GFM tables as tableContent rows with a header row', () => {
    const table = blocks[14].content as TableContent;
    expect(table.type).toBe('tableContent');
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0].isHeader).toBe(true);
    expect(table.rows[1].isHeader).toBe(false);
    expect(table.rows[0].cells.map((cell) => cell.map((s) => s.text).join(''))).toEqual([
      'Model',
      'Firmware',
      'Supported',
    ]);
    expect(table.rows[1].cells[2]).toEqual([{ type: 'text', text: 'yes', styles: { bold: true } }]);
  });
});

describe('kbImportBlocks html fidelity', () => {
  const blocks = htmlToBlocks(fixture('full-article.html'));

  it('produces the golden BlockNote document', () => {
    expect(blocks).toMatchSnapshot();
  });

  it('maps every supported block construct and drops script/style content', () => {
    expect(types(blocks)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'bulletListItem',
      'bulletListItem',
      'bulletListItem',
      'heading',
      'numberedListItem',
      'numberedListItem',
      'numberedListItem',
      'blockquote',
      'codeBlock',
      'table',
      'horizontalRule',
      'paragraph',
    ]);
    expect(JSON.stringify(blocks)).not.toContain('console.log');
    expect(JSON.stringify(blocks)).not.toContain('color: red');
  });

  it('keeps heading levels and the code fence language from the class attribute', () => {
    expect(blocks[0].props).toEqual({ level: 1 });
    expect(blocks[6].props).toEqual({ level: 3 });
    expect(blocks[11].props).toEqual({ language: 'powershell' });
    expect(plainText(blocks[11])).toBe('Restart-Service -Name Spooler');
  });

  it('emits inline styled segments and decodes entities', () => {
    expect(inline(blocks[1])).toEqual([
      { type: 'text', text: 'Restart the ' },
      { type: 'text', text: 'spooler', styles: { bold: true } },
      { type: 'text', text: ' service, then ' },
      { type: 'text', text: 'retry', styles: { italic: true } },
      { type: 'text', text: ' the job. Run ' },
      { type: 'text', text: 'net stop spooler', styles: { code: true } },
      { type: 'text', text: ' and read the ' },
      { type: 'text', text: 'vendor guide', styles: { link: { href: 'https://example.com/printers' } } },
      { type: 'text', text: ' before escalating.' },
    ]);
    expect(plainText(blocks[14])).toBe(
      'Contact the helpdesk the vendor for "RMA" numbers & parts. Ask for a case ID.',
    );
    expect(inline(blocks[14])).toContainEqual({
      type: 'text',
      text: 'the helpdesk',
      styles: { strike: true },
    });
  });

  it('builds HTML tables as tableContent rows flagged from th cells', () => {
    const table = blocks[12].content as TableContent;
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0].isHeader).toBe(true);
    expect(table.rows[2].isHeader).toBe(false);
    expect(table.rows[1].cells.map((cell) => cell.map((s) => s.text).join(''))).toEqual([
      'LX-100',
      '2.4.1',
      'yes',
    ]);
    expect(table.rows[1].cells[2][0].styles).toEqual({ bold: true });
  });

  it('preserves semantic containers around nested paragraphs', () => {
    const nested = htmlToBlocks(
      '<blockquote><p>Quoted text</p></blockquote><ol><li><p>First</p></li></ol>',
    );

    expect(nested).toEqual([
      { type: 'blockquote', content: [{ type: 'text', text: 'Quoted text' }] },
      { type: 'numberedListItem', content: [{ type: 'text', text: 'First' }] },
    ]);
  });
});

describe('kbImportBlocks entry points', () => {
  it('routes html extensions to the html walker and everything else to markdown', () => {
    expect(fileContentToBlocks('guide.htm', '<h2>Hi</h2>')).toEqual([
      { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Hi' }] },
    ]);
    expect(fileContentToBlocks('guide.md', '## Hi')).toEqual([
      { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Hi' }] },
    ]);
  });

  it('derives a title from the filename', () => {
    expect(titleFromFilename('printer_troubleshooting-guide.md')).toBe('Printer Troubleshooting Guide');
    expect(titleFromFilename('vpn-setup.HTML')).toBe('Vpn Setup');
  });

  it('handles empty and whitespace-only input', () => {
    expect(markdownToBlocks('')).toEqual([]);
    expect(markdownToBlocks('\n\n   \n')).toEqual([]);
    expect(htmlToBlocks('')).toEqual([]);
    expect(htmlToBlocks('   \n  ')).toEqual([]);
  });
});

// Guards against reintroducing the quadratic/backtracking parser: every case
// below used to be minutes of blocked event loop (or an OOM) on a web pod.
describe('kbImportBlocks pathological input stays linear', () => {
  const PARSE_BUDGET_MS = 2000;

  const timed = (fn: () => BlockNoteBlock[]): number => {
    const startedAt = Date.now();
    fn();
    return Date.now() - startedAt;
  };

  it('parses a multi-MB single-line HTML document', () => {
    const html = `<div>${'<span>chunk of text </span>'.repeat(120_000)}</div>`;
    expect(html.length).toBeGreaterThan(3_000_000);
    expect(timed(() => htmlToBlocks(html))).toBeLessThan(PARSE_BUDGET_MS);
  });

  it('parses a multi-MB single-line markdown paragraph', () => {
    const markdown = 'word '.repeat(600_000);
    expect(markdown.length).toBeGreaterThan(2_000_000);
    expect(timed(() => markdownToBlocks(markdown))).toBeLessThan(PARSE_BUDGET_MS);
  });

  it('parses ~100k unmatched emphasis markers', () => {
    expect(timed(() => markdownToBlocks('*'.repeat(100_000)))).toBeLessThan(PARSE_BUDGET_MS);
    expect(timed(() => markdownToBlocks('a*b '.repeat(25_000)))).toBeLessThan(PARSE_BUDGET_MS);
  });

  it('parses ~100k unmatched backticks and brackets', () => {
    expect(timed(() => markdownToBlocks('`'.repeat(100_000)))).toBeLessThan(PARSE_BUDGET_MS);
    expect(timed(() => markdownToBlocks('['.repeat(100_000)))).toBeLessThan(PARSE_BUDGET_MS);
    expect(timed(() => markdownToBlocks('[a](b '.repeat(20_000)))).toBeLessThan(PARSE_BUDGET_MS);
  });

  it('parses deeply unbalanced HTML tags', () => {
    expect(timed(() => htmlToBlocks('<div>'.repeat(50_000)))).toBeLessThan(PARSE_BUDGET_MS);
    expect(timed(() => htmlToBlocks('<b>a'.repeat(50_000)))).toBeLessThan(PARSE_BUDGET_MS);
  });

  it('enforces the cooperative parse deadline', () => {
    const html = `<p>${'text '.repeat(1_000_000)}</p>`;
    expect(() => htmlToBlocks(html, { maxDurationMs: 1 })).toThrow(KbImportParseTimeoutError);
  });
});
