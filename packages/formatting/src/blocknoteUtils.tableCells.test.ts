import { describe, expect, it } from 'vitest';
import { formatBlockNoteContent, convertBlockNoteToMarkdown } from './blocknoteUtils';

const inline = (text: string) => [{ type: 'text', text, styles: {} }];
const objCell = (text: string) => ({ type: 'tableCell', content: text ? inline(text) : [] });
const table = (rows: unknown[][]) => ({
  type: 'table',
  content: { type: 'tableContent', rows: rows.map((cells) => ({ cells })) },
});

describe('table cell shapes (alga-2026-0003184)', () => {
  it('legacy array cells keep their text in both renditions', () => {
    const blocks = [table([[inline('Host'), inline('State')], [inline('web01'), inline('DOWN')]])];
    const md = convertBlockNoteToMarkdown(blocks as any);
    expect(md).toContain('| Host | State |');
    expect(md).toContain('| web01 | DOWN |');
    const { html } = formatBlockNoteContent(blocks as any);
    expect(html).toContain('<td>web01</td>');
    expect(html).toContain('<td>DOWN</td>');
  });

  it('tableCell object cells keep their text in both renditions', () => {
    const blocks = [table([[objCell('Host'), objCell('State')], [objCell('web01'), objCell('DOWN')]])];
    const md = convertBlockNoteToMarkdown(blocks as any);
    expect(md).toContain('| Host | State |');
    expect(md).toContain('| web01 | DOWN |');
    const { html, text } = formatBlockNoteContent(blocks as any);
    expect(html).toContain('<td>web01</td>');
    expect(html).toContain('<td>DOWN</td>');
    expect(text).toContain('web01');
  });

  it('bare {content} cells are read too', () => {
    const blocks = [table([[{ content: inline('A') }, { content: inline('B') }]])];
    expect(convertBlockNoteToMarkdown(blocks as any)).toContain('| A | B |');
  });

  it('mixed rows render every cell', () => {
    const blocks = [table([[inline('a'), objCell('b')], [objCell('c'), inline('d')]])];
    const md = convertBlockNoteToMarkdown(blocks as any);
    expect(md).toContain('| a | b |');
    expect(md).toContain('| c | d |');
    const { html } = formatBlockNoteContent(blocks as any);
    for (const t of ['a', 'b', 'c', 'd']) expect(html).toContain(`<td>${t}</td>`);
  });

  it('empty cells stay structurally empty', () => {
    const blocks = [table([[objCell('x'), objCell('')], [inline(''), objCell('y')]])];
    const md = convertBlockNoteToMarkdown(blocks as any);
    expect(md).toContain('| x |   |');
    expect(md).toContain('|   | y |');
    const { html } = formatBlockNoteContent(blocks as any);
    expect(html).toContain('<td>x</td><td><br></td>');
    expect(html).toContain('<td></td><td>y</td>');
  });

  it('unrecognised cell shapes render empty, not throw', () => {
    const blocks = [table([['str', null, 5, { type: 'tableCell' }]])];
    const { html } = formatBlockNoteContent(blocks as any);
    expect(html).toContain('<td><br></td><td><br></td><td><br></td><td><br></td>');
  });

  it('paragraph-only output is unchanged', () => {
    const { html } = formatBlockNoteContent([{ type: 'paragraph', content: inline('hello') }] as any);
    expect(html).toBe('<p style="margin:0 0 10px 0;">hello</p>');
  });
});
