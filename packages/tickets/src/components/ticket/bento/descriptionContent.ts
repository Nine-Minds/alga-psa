/**
 * Whether a parsed rich-text description has anything in it. A parsed-but-empty
 * description is a paragraph holding an empty text run, so only real text or a
 * non-text node (image, mention, table, …) counts.
 */
export function hasDescriptionContent(blocks: unknown[]): boolean {
  const hasContent = (node: unknown): boolean => {
    if (node == null) return false;
    if (typeof node === 'string') return node.trim().length > 0;
    if (Array.isArray(node)) return node.some(hasContent);
    if (typeof node !== 'object') return false;
    const n = node as { type?: string; text?: string; content?: unknown; children?: unknown };
    if (typeof n.text === 'string') return n.text.trim().length > 0;
    if (n.type && !['paragraph', 'text', 'heading'].includes(n.type) && n.content === undefined) return true;
    return hasContent(n.content) || hasContent(n.children);
  };
  return blocks.some(hasContent);
}
