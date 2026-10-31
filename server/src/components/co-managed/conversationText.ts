import { snapshotConversationDocument, type CoManagedRichTextDocument } from '@alga-psa/co-managed/conversationRichText';

/** Render authorized text without resolving embedded images, documents or local
 * mentions against the viewer's tenant. Attachment rendering has its own gate. */
export function conversationText(note: string | null, markdown: string | null): string {
  if (!note) return markdown ?? '';
  let document: unknown;
  try { document = JSON.parse(note); } catch { return note; }
  if (!Array.isArray(document)) return note;
  let remaining = 20000;
  const text = (value: unknown, depth = 0): string => {
    if (depth > 32 || remaining-- <= 0 || !value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(item => text(item, depth + 1)).join('');
    if (typeof value !== 'object') return '';
    const item = value as Record<string, unknown>;
    if (typeof item.text === 'string') return item.text;
    return text(item.content, depth + 1);
  };
  const blocks = (items: unknown[], depth = 0): string => depth > 32 ? '' : items.map(value => {
    if (!value || typeof value !== 'object') return '';
    const block = value as Record<string, unknown>;
    return [text(block.content), Array.isArray(block.children) ? blocks(block.children, depth + 1) : ''].filter(Boolean).join('\n');
  }).join('\n');
  return blocks(document);
}

/** Preserve validated blocks verbatim; unsupported embedded resources cannot be
 * flattened into a destructive edit. Legacy raw strings remain literal text. */
export function conversationDocument(note: string | null): CoManagedRichTextDocument | null {
  if (!note) return null;
  let value: unknown;
  try { value = JSON.parse(note); } catch {
    value = [{ type: 'paragraph', content: [{ type: 'text', text: note, styles: {} }] }];
  }
  try { return snapshotConversationDocument(value, true); } catch { return null; }
}
