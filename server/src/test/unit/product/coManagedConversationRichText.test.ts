import { expect, it } from 'vitest';
import { snapshotConversationDocument, conversationDocumentMarkdown } from '../../../../../packages/co-managed/src/conversationRichText';
import { snapshotConversationContent, encodeConversationContent, plainTextContent } from '../../../../../packages/co-managed/src/conversationContent';
const text = (value = 'Text', styles = {}) => ({ type: 'text', text: value, styles });
const paragraph = (content: any[] = [text()]) => ({ type: 'paragraph', content });
it('preserves formatting, nested blocks, tables and safe links in a detached snapshot', () => {
  const document = [{ type: 'heading', props: { level: 2 }, content: [text('Title', { bold: true })], children: [paragraph()] },
    paragraph([{ type: 'link', href: 'https://example.test/path', content: [text('Link', { italic: true })] }]),
    { type: 'table', content: { type: 'tableContent', rows: [{ cells: [[text('Header')]] }, { cells: [{ type: 'tableCell', props: { colspan: 1, rowspan: 1 }, content: [text('Value')] }] }] } }];
  const saved = snapshotConversationDocument(document);
  document[0].content![0].text = 'Changed';
  expect(saved[0].content[0].text).toBe('Title');
  expect(conversationDocumentMarkdown(saved)).toContain('## **Title**');
  expect(conversationDocumentMarkdown(saved)).toContain('[*Link*](<https://example.test/path>)');
  expect(conversationDocumentMarkdown(saved)).toContain('| Header |\n| --- |\n| Value |');
  expect(JSON.parse(encodeConversationContent({ document: saved }).note)).toEqual(saved);
});
it.each(['javascript:alert(1)', 'data:text/html,bad', '/api/attachments/foreign', 'https://example.test/"bad', 'https://example.test/\\bad', 'java\nscript:bad'])('rejects an unsafe or tenant-relative link: %s', href => {
  expect(() => snapshotConversationDocument([paragraph([{ type: 'link', href, content: [text()] }])])).toThrow();
});
it.each(['image', 'audio', 'file', 'video', 'mention', 'unknown'])('rejects resource-bearing or unknown block %s instead of stripping it', type => {
  expect(() => snapshotConversationDocument([paragraph(), { type, props: { url: 'https://example.test/secret' } }])).toThrow();
});
it('rejects inline mentions, hidden resource properties, duplicate IDs and malformed structures', () => {
  for (const document of [
    [paragraph([{ type: 'mention', props: { userId: 'foreign' } }])],
    [{ ...paragraph(), props: { url: 'https://example.test/secret' } }],
    [{ ...paragraph(), id: 'same' }, { ...paragraph(), id: 'same' }],
    [paragraph([text('Color', { textColor: '#12345' })])],
    [{ type: 'table', content: { type: 'tableContent', rows: [] } }],
    [paragraph([text('Null\0byte')])],
  ]) expect(() => snapshotConversationDocument(document)).toThrow();
});
it('bounds document depth, node count, serialized size and text length', () => {
  let nested: any = paragraph(); for (let i = 0; i < 14; i++) nested = { ...paragraph(), children: [nested] };
  for (const document of [[nested], Array.from({ length: 5001 }, () => paragraph()), [paragraph([text('x'.repeat(100001))])]])
    expect(() => snapshotConversationDocument(document)).toThrow();
  const cycle: any = paragraph(); cycle.children = [cycle]; expect(() => snapshotConversationDocument([cycle])).toThrow();
  expect(() => snapshotConversationDocument([])).toThrow(); expect(snapshotConversationDocument([], true)).toEqual([]);
});
it('keeps literal HTML and markdown text inert and uses code fences longer than embedded fences', () => {
  const markdown = conversationDocumentMarkdown(snapshotConversationDocument([paragraph([text('<img src=x> **literal**')]),
    { type: 'codeBlock', props: { language: 'ts' }, content: [text('```\n<script>literal</script>')] }]));
  expect(markdown).toContain('&lt;img src=x&gt; \\*\\*literal\\*\\*');
  expect(markdown).toContain('````ts\n```\n<script>literal</script>\n````');
});
it('retains the legacy text encoding and rejects mixed or independently supplied representations', () => {
  const input = { text: ' **literal** <tag> ' };
  expect(snapshotConversationContent(input)).toEqual(input);
  expect(encodeConversationContent(snapshotConversationContent(input))).toEqual(plainTextContent(input.text));
  expect(() => snapshotConversationContent({ text: 'Text', document: [paragraph()] })).toThrow();
  expect(() => snapshotConversationContent({ document: [paragraph([text(' ')])] })).toThrow();
});
it('accepts merged table cells and rejects overlapping, ragged or out-of-bounds spans', () => {
  const cell = (value: string, props = {}) => ({ type: 'tableCell', props, content: [text(value)] });
  const table = (rows: any[], other = {}) => [{ type: 'table', content: { type: 'tableContent', rows: rows.map(cells => ({ cells })), ...other } }];
  const merged = snapshotConversationDocument(table([[cell('Merged', { rowspan: 2 }), cell('Top')], [cell('Bottom')]]));
  expect(conversationDocumentMarkdown(merged)).toBe('| Merged | Top |\n| --- | --- |\n|  | Bottom |');
  expect(snapshotConversationDocument(table([[cell('All', { rowspan: 2, colspan: 2 })], []]))).toHaveLength(1);
  for (const invalid of [table([[cell('A')], [cell('B'), cell('C')]]), table([[cell('A', { rowspan: 2 })]]),
    table([[cell('A'), cell('B', { rowspan: 2 })], [cell('Overlap', { colspan: 2 })]]), table([[cell('A')]], { headerRows: 2 }),
    table([[cell('A')]], { columnWidths: [100, 100] })]) expect(() => snapshotConversationDocument(invalid)).toThrow();
});
