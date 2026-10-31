import { expect, it } from 'vitest';
import { portableDocumentReferenceRewriter, rewritePortableRichText, rewritePortableRecordRichText } from '../../../../../packages/co-managed/src/portableRichTextReferences';

const file = '00000000-0000-4000-8000-000000000001', nextFile = '00000000-0000-4000-8000-000000000002';
const document = '00000000-0000-4000-8000-000000000003', nextDocument = '00000000-0000-4000-8000-000000000004';
const files = new Map([[file, nextFile]]), documents = new Map([[document, nextDocument]]);
const url = `/api/documents/view/${file}`, rewrite = portableDocumentReferenceRewriter(files, documents);

it('remaps native file/document routes with their exact query and fragment suffixes', () => {
  expect(rewrite(`${url}?format=png#figure`)).toBe(`/api/documents/view/${nextFile}?format=png#figure`);
  expect(rewrite(`/api/documents/download/${document}?format=pdf`)).toBe(`/api/documents/download/${nextDocument}?format=pdf`);
  expect(rewrite(`/api/documents/${document}/preview?mode=thumbnail`)).toBe(`/api/documents/${nextDocument}/preview?mode=thumbnail`);
});
it('does not reinterpret external, protocol-relative, unknown or noncanonical paths as native identities', () => {
  for (const value of [`https://other.example${url}`, `//other.example${url}`, `/prefix${url}`, `${url}/extra`, `Text ${url}`,
    '/api/documents/view/00000000-0000-4000-8000-000000000099', `/api/documents/${file}/preview`]) expect(rewrite(value)).toBe(value);
});
it('rejects ambiguous native identities instead of guessing which resource a legacy route means', () => {
  const ambiguous = portableDocumentReferenceRewriter(files, new Map([[file, nextDocument]]));
  expect(() => ambiguous(url)).toThrow('Ambiguous');
  expect(ambiguous(`/api/documents/${file}/preview`)).toBe(`/api/documents/${nextDocument}/preview`);
});
it('repairs Tiptap media and link marks while preserving literal text, alt text and arbitrary attributes', () => {
  const source = { type: 'doc', content: [{ type: 'image', attrs: { src: url, alt: url, metadata: { src: url } } },
    { type: 'paragraph', content: [{ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url, title: url } }] }] },
    { type: 'codeBlock', content: [{ type: 'text', text: url }] }] };
  const original = structuredClone(source), result = rewritePortableRichText(source, rewrite) as typeof source;
  expect(source).toEqual(original);
  expect(result.content[0].attrs).toEqual({ src: rewrite(url), alt: url, metadata: { src: url } });
  expect(result.content[1].content![0]).toMatchObject({ text: url, marks: [{ type: 'link', attrs: { href: rewrite(url), title: url } }] });
  expect(result.content[2]).toEqual(source.content[2]);
});
it('repairs serialized BlockNote media, nested links and table cells without changing serialization type', () => {
  const source = JSON.stringify([{ type: 'paragraph', children: [{ type: 'image', props: { url, caption: url } }] },
    { type: 'table', content: { type: 'tableContent', rows: [{ cells: [[{ type: 'link', href: url, content: [{ type: 'text', text: 'image' }] }]] }] } }]);
  const value = rewritePortableRichText(source, rewrite);
  expect(typeof value).toBe('string'); const result = JSON.parse(value as string);
  expect(result[0].children[0].props).toEqual({ url: rewrite(url), caption: url });
  expect(result[1].content.rows[0].cells[0][0].href).toBe(rewrite(url));
});
it('preserves exact untouched JSON, plain text and non-editor configuration', () => {
  for (const value of [' [ { "type": "text", "text": "literal" } ] ', `literal ${url}`, file,
    JSON.stringify({ type: 'workflow', attrs: { src: url } }), null]) expect(rewritePortableRichText(value, rewrite)).toBe(value);
});
it('rewrites Markdown destinations and reference definitions while preserving titles, labels and whitespace', () => {
  const source = `![${url}](<${url}> "${url}")\n\n[link][ref]\n\n[ref]: ${url}?format=pdf '${url}'\n`;
  expect(rewritePortableRichText(source, rewrite)).toBe(`![${url}](<${rewrite(url)}> "${url}")\n\n[link][ref]\n\n[ref]: ${rewrite(url)}?format=pdf '${url}'\n`);
});
it('rewrites raw HTML media/link attributes with original quoting, case and entity escaping intact', () => {
  const source = `<DIV>\n<IMG\n SRC = '${url}?a=1&amp;b=2' alt="${url}"><a href=${url}>${url}</a>\n</DIV>`;
  expect(rewritePortableRichText(source, rewrite)).toBe(`<DIV>\n<IMG\n SRC = '${rewrite(url)}?a=1&amp;b=2' alt="${url}"><a href=${rewrite(url)}>${url}</a>\n</DIV>`);
});
it('preserves Markdown code and raw HTML literal elements, even across separately parsed inline tags', () => {
  const image = `![literal](${url})`, html = `<img src="${url}">`;
  for (const source of [`\`${image}\``, `\`\`\`html\n${html}\n\`\`\``, `    ${image}\n`,
    `<pre>${html}</pre>`, `<code>${html} ${image}</code>`, `<script>const x = '${url}'</script>`,
    `<textarea>${html}</textarea>`, `<!-- ${html} -->`]) expect(rewritePortableRichText(source, rewrite)).toBe(source);
});
it('limits record rewriting to declared rich-text columns and leaves authored workflow/configuration alone', () => {
  const rich = [{ type: 'image', props: { url } }];
  const records = { documents: [{ content: rich, document_name: url }], document_block_content: [{ block_data: JSON.stringify(rich) }],
    project_tasks: [{ description_rich_text: JSON.stringify({ type: 'doc', content: [{ type: 'image', attrs: { src: url } }] }) }],
    workflow_definitions: [{ definition: rich }], ticket_audit_logs: [{ details: rich }] };
  rewritePortableRecordRichText(records, files, documents);
  expect(records.documents[0]).toEqual({ content: [{ type: 'image', props: { url: rewrite(url) } }], document_name: url });
  expect(JSON.parse(records.document_block_content[0].block_data)[0].props.url).toBe(rewrite(url));
  expect(JSON.parse(records.project_tasks[0].description_rich_text).content[0].attrs.src).toBe(rewrite(url));
  expect(records.workflow_definitions[0].definition).toEqual(rich); expect(records.ticket_audit_logs[0].details).toEqual(rich);
});
