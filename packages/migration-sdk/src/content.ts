import { rewriteAmpMarkup } from './markup';
type Row = Record<string, unknown>;
const MEDIA = new Set(['image', 'video', 'audio', 'file']);
const object = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Tiptap/ProseMirror and BlockNote expose explicit media/link fields. Preserve
 * unknown node attributes and literal code/text; only walk editor child slots.
 * Serialized editor JSON stays serialized, and untouched values stay exact. */
export function rewriteAmpContent(value: unknown, rewriteUrl: (url: string) => string): unknown {
  let content = value;
  if (typeof content === 'string') {
    const text = content;
    try { content = JSON.parse(text); } catch { return rewriteAmpMarkup(text, rewriteUrl); }
  }
  if (!Array.isArray(content) && (!object(content) || content.type !== 'doc')) return value;
  const copy = structuredClone(content); let changed = false, visited = 0;
  const field = (record: unknown, key: string) => {
    if (!object(record) || typeof record[key] !== 'string') return;
    const next = rewriteUrl(record[key]); if (next !== record[key]) { record[key] = next; changed = true; }
  };
  const walk = (node: unknown, depth: number) => {
    if (++visited > 1_000_000 || depth > 128) throw new Error('AMP rich-text structure exceeds limits');
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
