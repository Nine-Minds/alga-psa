/** Pure BlockNote document boundary shared by browser and command adapters.
 * Embedded resources and mentions require qualified resolvers before admission. */
export type CoManagedRichTextDocument = Array<Record<string, any>>;
export class CoManagedRichTextError extends Error {
  constructor() { super('The conversation document is not valid.'); this.name = 'CoManagedRichTextError'; }
}
const fail = (): never => { throw new CoManagedRichTextError(); };
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value : fail();
function keys(value: Record<string, any>, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) fail(); }
const color = (value: unknown) => typeof value === 'string' && (/^(default|gray|brown|red|orange|yellow|green|blue|purple|pink|black|white|transparent)$/.test(value) || /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value));
const integer = (value: unknown, min: number, max: number) => Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
/** Expand merged cells into a bounded rectangular grid. Covered positions stay
 * empty in derived Markdown, while JSON retains the original spans. */
function tableGrid(rows: Array<{ cells: any[] }>): any[][] {
  const grid: any[][] = rows.map(() => []);
  rows.forEach((row, rowIndex) => {
    let column = 0;
    row.cells.forEach(cell => {
      while (grid[rowIndex][column] !== undefined) column++;
      const width = Array.isArray(cell) ? 1 : cell.props.colspan ?? 1;
      const height = Array.isArray(cell) ? 1 : cell.props.rowspan ?? 1;
      if (column + width > 200 || rowIndex + height > rows.length) fail();
      for (let y = rowIndex; y < rowIndex + height; y++) for (let x = column; x < column + width; x++) {
        if (grid[y][x] !== undefined) fail();
        grid[y][x] = y === rowIndex && x === column ? cell : null;
      }
      column += width;
    });
  });
  const width = grid[0]?.length ?? 0;
  if (!width || grid.some(row => row.length !== width || Array.from({ length: width }, (_, x) => row[x]).some(cell => cell === undefined))) fail();
  return grid;
}
export function snapshotConversationDocument(input: unknown, allowEmpty = false): CoManagedRichTextDocument {
  let encoded: string;
  try { encoded = JSON.stringify(input); } catch { return fail(); }
  if (!encoded || encoded.length > 500000 || encoded.includes('\\u0000')) fail();
  const source: unknown = JSON.parse(encoded);
  let budget = 5000, textLength = 0, totalLength = 0;
  const visit = () => { if (--budget < 0) fail(); };
  const props = (input: unknown, allowed: string[]) => {
    const value = input === undefined ? {} : object(input); keys(value, allowed);
    for (const [key, item] of Object.entries(value)) {
      if (['textColor', 'backgroundColor'].includes(key) && !color(item)) fail();
      if (key === 'textAlignment' && !['left', 'center', 'right', 'justify'].includes(item as string)) fail();
      if (['checked', 'isToggleable'].includes(key) && typeof item !== 'boolean') fail();
      if (key === 'level' && !integer(item, 1, 6)) fail();
      if (key === 'start' && !integer(item, 1, 1000000)) fail();
      if (['colspan', 'rowspan'].includes(key) && !integer(item, 1, 200)) fail();
      if (key === 'language' && (typeof item !== 'string' || !/^[a-z0-9_+#.-]{0,80}$/i.test(item))) fail();
    }
    return value;
  };
  const inline = (input: unknown, linked = false): any[] => {
    if (!Array.isArray(input)) fail();
    return (input as unknown[]).map(raw => {
      visit(); const value = object(raw);
      if (value.type === 'text') {
        keys(value, ['type', 'text', 'styles']);
        if (typeof value.text !== 'string' || value.text.includes('\0')) fail();
        textLength += value.text.trim().length;
        totalLength += value.text.length; if (totalLength > 100000) fail();
        const styles = value.styles === undefined ? {} : object(value.styles);
        keys(styles, ['bold', 'italic', 'underline', 'strike', 'code', 'textColor', 'backgroundColor']);
        for (const [key, item] of Object.entries(styles)) {
          if (['textColor', 'backgroundColor'].includes(key) ? !color(item) : typeof item !== 'boolean') fail();
        }
        return { ...value, styles };
      }
      if (value.type !== 'link' || linked) fail();
      keys(value, ['type', 'href', 'content']);
      if (typeof value.href !== 'string' || value.href.length > 8192 || /[\u0000-\u0020"<>\\]/.test(value.href)) fail();
      let url: URL; try { url = new URL(value.href); } catch { return fail(); }
      if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) fail();
      return { type: 'link', href: url.href, content: inline(value.content, true) };
    });
  };
  const baseProps = ['backgroundColor', 'textColor', 'textAlignment'];
  const blockProps: Record<string, string[]> = {
    paragraph: baseProps, heading: [...baseProps, 'level', 'isToggleable'], bulletListItem: baseProps,
    numberedListItem: [...baseProps, 'start'], checkListItem: [...baseProps, 'checked'], toggleListItem: baseProps,
    quote: baseProps, codeBlock: ['language'], divider: [], table: ['textColor'],
  };
  const ids = new Set<string>();
  const blocks = (input: unknown, depth: number): CoManagedRichTextDocument => {
    if (!Array.isArray(input) || depth > 12) fail();
    return (input as unknown[]).map(raw => {
      visit(); const value = object(raw); keys(value, ['id', 'type', 'props', 'content', 'children']);
      if (typeof value.type !== 'string' || !Object.hasOwn(blockProps, value.type)) fail();
      if (value.id !== undefined) {
        if (typeof value.id !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(value.id) || ids.has(value.id)) fail();
        ids.add(value.id);
      }
      const result = { ...value, props: props(value.props, blockProps[value.type]), children: blocks(value.children ?? [], depth + 1) };
      if (value.type === 'divider') { if (value.content !== undefined) fail(); return result; }
      if (value.type !== 'table') return { ...result, content: inline(value.content ?? []) };
      const table = object(value.content); keys(table, ['type', 'columnWidths', 'headerRows', 'headerCols', 'rows']);
      if (table.type !== 'tableContent' || !Array.isArray(table.rows) || !table.rows.length || table.rows.length > 200) fail();
      for (const key of ['headerRows', 'headerCols']) if (table[key] !== undefined && !integer(table[key], 0, 200)) fail();
      if (table.columnWidths !== undefined && (!Array.isArray(table.columnWidths) || table.columnWidths.length > 200 || table.columnWidths.some((n: unknown) => n !== null && (!Number.isFinite(n) || Number(n) < 0 || Number(n) > 20000)))) fail();
      const rows = table.rows.map((rawRow: unknown) => {
        visit(); const row = object(rawRow); keys(row, ['cells']);
        if (!Array.isArray(row.cells) || row.cells.length > 200) fail();
        return { cells: row.cells.map((rawCell: unknown) => {
          visit(); if (Array.isArray(rawCell)) return inline(rawCell);
          const cell = object(rawCell); keys(cell, ['type', 'props', 'content']);
          if (cell.type !== 'tableCell') fail();
          return { type: 'tableCell', props: props(cell.props, [...baseProps, 'colspan', 'rowspan']), content: inline(cell.content) };
        }) };
      });
      const grid = tableGrid(rows);
      if ((table.headerRows ?? 0) > rows.length || (table.headerCols ?? 0) > grid[0].length ||
          (table.columnWidths !== undefined && table.columnWidths.length !== grid[0].length)) fail();
      return { ...result, content: { ...table, rows } };
    });
  };
  const result = blocks(source, 0);
  if (!allowEmpty && !textLength) fail();
  return result;
}

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#+\-.!|~])/g, '\\$1');
/** Markdown is derived, never trusted from a caller independently of the blocks. */
export function conversationDocumentMarkdown(document: CoManagedRichTextDocument): string {
  const inline = (items: any[]): string => items.map(item => {
    if (item.type === 'link') return `[${inline(item.content)}](<${item.href}>)`;
    let text = escapeText(item.text), styles = item.styles ?? {};
    if (styles.code) { const fence = '`'.repeat(Math.max(1, ...(item.text.match(/`+/g) ?? []).map((run: string) => run.length + 1))); return `${fence} ${item.text} ${fence}`; }
    if (styles.bold) text = `**${text}**`;
    if (styles.italic) text = `*${text}*`;
    if (styles.underline) text = `<u>${text}</u>`;
    if (styles.strike) text = `~~${text}~~`;
    return text;
  }).join('');
  const blocks = (values: CoManagedRichTextDocument, depth = 0): string => values.map(block => {
    let body: string;
    if (block.type === 'table') {
      const grid = tableGrid(block.content.rows);
      const rows = grid.map(row => `| ${row.map(cell => cell === null ? '' : inline(Array.isArray(cell) ? cell : cell.content).replace(/\n/g, '<br>')).join(' | ')} |`);
      rows.splice(1, 0, `| ${grid[0].map(() => '---').join(' | ')} |`); body = rows.join('\n');
    } else if (block.type === 'divider') body = '---';
    else if (block.type === 'codeBlock') {
      const text = block.content.map((item: any) => item.type === 'text' ? item.text : item.content.map((part: any) => part.text).join('')).join('');
      const fence = '`'.repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map((run: string) => run.length + 1)));
      body = `${fence}${block.props.language ?? ''}\n${text}\n${fence}`;
    } else {
      body = inline(block.content);
      if (block.type === 'heading') body = `${'#'.repeat(block.props.level ?? 1)} ${body}`;
      if (block.type === 'quote') body = body.split('\n').map(line => `> ${line}`).join('\n');
      if (['bulletListItem', 'toggleListItem'].includes(block.type)) body = `- ${body}`;
      if (block.type === 'numberedListItem') body = `${block.props.start ?? 1}. ${body}`;
      if (block.type === 'checkListItem') body = `- [${block.props.checked ? 'x' : ' '}] ${body}`;
    }
    const children = block.children?.length ? `\n${blocks(block.children, depth + 1)}` : '';
    return body.split('\n').map(line => `${'  '.repeat(depth)}${line}`).join('\n') + children;
  }).join('\n\n');
  return blocks(document);
}
