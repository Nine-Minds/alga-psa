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

// Stored blocks are read by consumers that do not all sanitize at render, so
// script-bearing hrefs must be dropped at conversion time -- the same guard
// shared/lib/utils/markdownToBlocks.ts applies.
describe('kbImportBlocks link sanitization', () => {
  const hrefOf = (blocks: BlockNoteBlock[]): unknown =>
    (inline(blocks[0]).find((segment) => segment.styles?.link)?.styles?.link as
      | Record<string, string>
      | undefined)?.href;

  it.each([
    'javascript:alert(document.cookie)',
    'JaVaScRiPt:alert(1)',
    '<javascript:alert(1)>',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
  ])('drops the %s scheme from a markdown link', (href) => {
    const blocks = markdownToBlocks(`[click me](${href})`);
    expect(hrefOf(blocks)).toBe('');
    expect(JSON.stringify(blocks).toLowerCase()).not.toContain('script:');
    expect(plainText(blocks[0])).toBe('click me');
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    // Entities are decoded before the walker sees the attribute, so an obfuscated
    // scheme has to be caught after decoding -- including embedded control chars,
    // which browsers strip before resolving the URL.
    '&#106;avascript:alert(1)',
    'java&#9;script:alert(1)',
    ' javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
  ])('drops the %s scheme from an html anchor', (href) => {
    const blocks = htmlToBlocks(`<p><a href="${href}">click me</a></p>`);
    expect(hrefOf(blocks)).toBe('');
    expect(JSON.stringify(blocks).toLowerCase()).not.toContain('script:');
  });

  // marked, unlike htmlparser2, hands back the href exactly as written. An
  // entity therefore survives into document_block_content and is decoded by
  // whichever consumer serializes the block back into HTML.
  it.each([
    '&#106;avascript:alert(1)',
    '&#106avascript:alert(1)',
    '&#x6a;avascript:alert(1)',
    'javascript&colon;alert(1)',
    'java&Tab;script:alert(1)',
    'java&NewLine;script:alert(1)',
  ])('drops the entity-encoded scheme %s from a markdown link', (href) => {
    const blocks = markdownToBlocks(`[click me](${href})`);
    expect(hrefOf(blocks)).toBe('');
    expect(plainText(blocks[0])).toBe('click me');
  });

  it('keeps entities that are not hiding a scheme', () => {
    expect(hrefOf(markdownToBlocks('[q](https://example.com/a?b=1&amp;c=2)'))).toBe(
      'https://example.com/a?b=1&amp;c=2',
    );
    expect(hrefOf(markdownToBlocks('[rel](page?a=1&amp;b=2)'))).toBe('page?a=1&amp;b=2');
    expect(hrefOf(markdownToBlocks('[amp](docs/AT&T)'))).toBe('docs/AT&T');
    expect(hrefOf(markdownToBlocks('[frag](#section)'))).toBe('#section');
  });

  it('emits an empty href for an anchor without one', () => {
    expect(hrefOf(htmlToBlocks('<p><a>no href</a></p>'))).toBe('');
  });

  it('keeps ordinary links intact', () => {
    expect(hrefOf(markdownToBlocks('[docs](https://example.com/a?b=1#c)'))).toBe(
      'https://example.com/a?b=1#c',
    );
    expect(hrefOf(markdownToBlocks('[mail](mailto:help@example.com)'))).toBe('mailto:help@example.com');
    expect(hrefOf(markdownToBlocks('[rel](../other/page.md)'))).toBe('../other/page.md');
    expect(hrefOf(htmlToBlocks('<p><a href="/kb/123">internal</a></p>'))).toBe('/kb/123');
  });
});

// Guards against reintroducing the quadratic/backtracking parser: every case
// below used to be minutes of blocked event loop (or an OOM) on a web pod.
// Multi-MB inputs on a CI runner shared with dozens of other projects overrun
// the default 10s per-test timeout that a dev laptop never notices.
describe('kbImportBlocks pathological input stays linear', { timeout: 120_000 }, () => {
  const timed = (fn: () => BlockNoteBlock[]): number => {
    const startedAt = Date.now();
    fn();
    return Date.now() - startedAt;
  };

  const fastestOf = (runs: number, fn: () => BlockNoteBlock[]): number =>
    Math.min(...Array.from({ length: runs }, () => timed(fn)));

  // A hard millisecond budget is not portable -- CI parses several times slower
  // than a laptop, so a bound tight enough to catch the regression flakes there.
  // Calibrate on this machine instead: the heaviest case below is 10x this
  // reference, so linear costs ~10x it and the quadratic pass we are guarding
  // against costs ~100x. A 40x budget sits between the two on any hardware.
  const REFERENCE_MS = Math.max(timed(() => markdownToBlocks('`a` '.repeat(25_000))), 20);
  const PARSE_BUDGET_MS = REFERENCE_MS * 40;

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

  // marked masks code spans / links / punctuation by rebuilding the source once
  // per match before any tokenizer hook runs. Packed into one block that used to
  // be quadratic: 977KB of code spans took ~31s, and no deadline could fire.
  it('parses a single ~1MB block dense with inline constructs', () => {
    expect(timed(() => markdownToBlocks('`a` '.repeat(250_000)))).toBeLessThan(PARSE_BUDGET_MS);
    expect(timed(() => markdownToBlocks('<i>x</i> '.repeat(120_000)))).toBeLessThan(PARSE_BUDGET_MS);
    expect(timed(() => markdownToBlocks('[a](b) '.repeat(150_000)))).toBeLessThan(PARSE_BUDGET_MS);
  });

  it('scales linearly as one inline-dense block grows', () => {
    // Code spans with no whitespace to split on: the densest shape we know of,
    // and the one that grew ~12x per doubling while the inline pass was quadratic.
    // Chunking holds this at ~2.5x per doubling (hard-splitting a window costs a
    // little more than splitting on whitespace), so bound it at 4x: clear of the
    // measured cost, and still an order of magnitude under the regression. Both
    // sizes take the fastest of two samples so one stalled run cannot skew the
    // ratio on a loaded runner.
    const half = fastestOf(2, () => markdownToBlocks('`a`'.repeat(42_500)));
    const full = fastestOf(2, () => markdownToBlocks('`a`'.repeat(85_000)));
    expect(full).toBeLessThan(Math.max(half, 20) * 4);
  });

  it('costs the same whether inline constructs sit in one block or many', () => {
    const oneBlock = timed(() => markdownToBlocks('`a` '.repeat(125_000)));
    const manyBlocks = timed(() =>
      markdownToBlocks(Array.from({ length: 1_250 }, () => '`a` '.repeat(100)).join('\n\n')),
    );
    expect(oneBlock).toBeLessThan(Math.max(manyBlocks, 20) * 10);
  });

  it('parses deeply unbalanced HTML tags', () => {
    expect(timed(() => htmlToBlocks('<div>'.repeat(50_000)))).toBeLessThan(PARSE_BUDGET_MS);
    expect(timed(() => htmlToBlocks('<b>a'.repeat(50_000)))).toBeLessThan(PARSE_BUDGET_MS);
  });

  it('enforces the cooperative parse deadline', () => {
    const html = `<p>${'text '.repeat(1_000_000)}</p>`;
    expect(() => htmlToBlocks(html, { maxDurationMs: 1 })).toThrow(KbImportParseTimeoutError);
  });

  it('enforces the cooperative parse deadline on markdown', () => {
    const markdown = 'word '.repeat(600_000);
    expect(markdown.length).toBeGreaterThan(3_000_000 - 1);
    expect(() => markdownToBlocks(markdown, { maxDurationMs: 1 })).toThrow(KbImportParseTimeoutError);
  });

  // The deadline has to fire *during* the inline pass, not only once it drains:
  // these shapes overran a 1s budget by 20-30x before the inline run was chunked.
  it('enforces the deadline inside a single inline-dense markdown block', () => {
    for (const markdown of [
      '`a` '.repeat(250_000),
      '<i>x</i> '.repeat(120_000),
      '[a](b) '.repeat(150_000),
      '`a`'.repeat(340_000),
    ]) {
      expect(markdown.length).toBeGreaterThan(900_000);
      const startedAt = Date.now();
      expect(() => markdownToBlocks(markdown, { maxDurationMs: 50 })).toThrow(
        KbImportParseTimeoutError,
      );
      expect(Date.now() - startedAt).toBeLessThan(PARSE_BUDGET_MS);
    }
  });

  it('normalizes CRLF identically across chunk boundaries', () => {
    const lines = Array.from({ length: 4_000 }, (_, i) => `Line ${i} with **bold** text.`);
    const lf = lines.join('\n\n');
    expect(lf.length).toBeGreaterThan(64 * 1024);
    expect(markdownToBlocks(lf.replace(/\n/g, '\r\n'))).toEqual(markdownToBlocks(lf));
    expect(markdownToBlocks(lf.replace(/\n/g, '\r'))).toEqual(markdownToBlocks(lf));
  });
});
