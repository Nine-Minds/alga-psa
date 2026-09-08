import { isCoManagedUuid } from './sharedWorkIdentity';
import { rewritePortableMarkup } from './portableMarkupReferences';

type Row = Record<string, unknown>;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const FILE_ROUTE = new RegExp(`^(/api/documents/(?:view|download)/)(${UUID})([?#].*)?$`, 'i');
const DOCUMENT_ROUTE = new RegExp(`^(/api/documents/)(${UUID})(/(?:download|thumbnail|preview|content)(?:[?#].*)?)$`, 'i');
const MEDIA = new Set(['image', 'video', 'audio', 'file']);
const RICH_TEXT_COLUMNS: Record<string, readonly string[]> = {
  documents: ['content'], document_content: ['content'], document_block_content: ['block_data'],
  comments: ['note', 'markdown_content'], project_task_comments: ['note', 'markdown_content'], project_tasks: ['description_rich_text', 'description'],
  kb_article_templates: ['content_template'],
};
const object = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Only explicit local document routes carry portable identities. An external
 * URL with the same pathname, or a UUID mentioned in prose/code, is not a local
 * reference. No URL is fetched and this transformer grants no file authority. */
export function portableDocumentReferenceRewriter(files: ReadonlyMap<string, string>, documents: ReadonlyMap<string, string>) {
  for (const mappings of [files, documents]) for (const [source, destination] of mappings) {
    if (!isCoManagedUuid(source) || source !== source.toLowerCase() || !isCoManagedUuid(destination)) throw new Error('Invalid portable content identity mapping');
  }
  return (url: string): string => {
    const file = FILE_ROUTE.exec(url), document = DOCUMENT_ROUTE.exec(url), match = file ?? document;
    if (!match) return url;
    const source = match[2].toLowerCase(), documentId = documents.get(source), fileId = file ? files.get(source) : undefined;
    // Legacy view/download routes accept either identity. Never guess when a
    // source UUID happens to identify two different resources.
    if (documentId && fileId && documentId !== fileId) throw new Error('Ambiguous portable content reference');
    const destination = fileId ?? documentId;
    return destination ? `${match[1]}${destination}${match[3] ?? ''}` : url;
  };
}

/** Tiptap/ProseMirror and BlockNote expose explicit media/link fields. Preserve
 * unknown node attributes and literal code/text; only walk editor child slots.
 * Serialized editor JSON stays serialized, and untouched values stay exact. */
export function rewritePortableRichText(value: unknown, rewriteUrl: (url: string) => string): unknown {
  let content = value;
  if (typeof content === 'string') {
    try { content = JSON.parse(content); } catch { return rewritePortableMarkup(content, rewriteUrl); }
  }
  if (!Array.isArray(content) && (!object(content) || content.type !== 'doc')) return value;
  const copy = structuredClone(content); let changed = false, visited = 0;
  const field = (record: unknown, key: string) => {
    if (!object(record) || typeof record[key] !== 'string') return;
    const next = rewriteUrl(record[key]); if (next !== record[key]) { record[key] = next; changed = true; }
  };
  const walk = (node: unknown, depth: number) => {
    if (++visited > 1_000_000 || depth > 128) throw new Error('Portable rich-text structure exceeds limits');
    if (Array.isArray(node)) { for (const child of node) walk(child, depth + 1); return; }
    if (!object(node)) return;
    if (MEDIA.has(String(node.type))) { field(node.attrs, 'src'); field(node.props, 'url'); }
    if (node.type === 'link') { field(node, 'href'); field(node.attrs, 'href'); }
    if (Array.isArray(node.marks)) for (const mark of node.marks) {
      if (object(mark) && mark.type === 'link') field(mark.attrs, 'href');
    }
    // BlockNote tables put inline content in tableContent.rows[].cells[].
    if (node.type === 'tableContent' && Array.isArray(node.rows)) for (const row of node.rows) {
      if (object(row) && Array.isArray(row.cells)) walk(row.cells, depth + 1);
    }
    if (node.type === 'codeBlock' || node.type === 'code') return;
    if (Array.isArray(node.content) || object(node.content)) walk(node.content, depth + 1);
    if (Array.isArray(node.children)) walk(node.children, depth + 1);
  };
  walk(copy, 0);
  return changed ? typeof value === 'string' ? JSON.stringify(copy) : copy : value;
}

export function rewritePortableRecordRichText(records: Record<string, Row[]>, files: ReadonlyMap<string, string>, documents: ReadonlyMap<string, string>) {
  const rewriteUrl = portableDocumentReferenceRewriter(files, documents);
  for (const [table, columns] of Object.entries(RICH_TEXT_COLUMNS)) for (const row of records[table] ?? []) {
    for (const column of columns) if (Object.hasOwn(row, column)) row[column] = rewritePortableRichText(row[column], rewriteUrl);
  }
}
