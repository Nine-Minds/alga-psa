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

/** Do not flatten a formatted or attached message into a destructive text edit. */
export function plainConversationDraft(note: string | null): string | null {
  if (!note) return null;
  let blocks: unknown;
  try { blocks = JSON.parse(note); } catch { return note; }
  if (!Array.isArray(blocks) || blocks.length > 10000) return null;
  const lines: string[] = [];
  for (const value of blocks) {
    if (!value || typeof value !== 'object') return null;
    const block = value as Record<string, any>;
    if (block.type !== 'paragraph' || (block.children?.length ?? 0) > 0 || !Array.isArray(block.content) ||
        Object.values(block.props ?? {}).some(value => !['left', 'default'].includes(value as string))) return null;
    let line = '';
    for (const inline of block.content) {
      if (!inline || inline.type !== 'text' || typeof inline.text !== 'string' || Object.values(inline.styles ?? {}).some(Boolean)) return null;
      line += inline.text;
    }
    lines.push(line);
  }
  return lines.join('\n');
}
