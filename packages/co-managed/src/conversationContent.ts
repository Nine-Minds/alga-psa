import { snapshotConversationDocument, conversationDocumentMarkdown, type CoManagedRichTextDocument } from './conversationRichText';

export function plainTextContent(text: string) {
  // This command accepts text, never caller-supplied HTML, block IDs, uploads or
  // embedded URLs. Encode text nodes so JSON-looking input stays literal text.
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return { note: JSON.stringify(lines.map(line => ({ type: 'paragraph', content: [{ type: 'text', text: line, styles: {} }] }))),
    markdown_content: lines.map(line => line.replace(/([\\`*_{}\[\]()#+\-.!|~>])/g, '\\$1').replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('\n\n') };
}

export type CoManagedConversationContent = { text: string; document?: never } | { document: CoManagedRichTextDocument; text?: never };
export function snapshotConversationContent(input: { text?: unknown; document?: unknown }): CoManagedConversationContent {
  if (input.document !== undefined) {
    if (input.text !== undefined) throw new Error('Choose one conversation content format');
    return { document: snapshotConversationDocument(input.document) };
  }
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 100000 || input.text.includes('\0')) throw new Error('Invalid conversation text');
  return { text: input.text };
}
export function encodeConversationContent(content: CoManagedConversationContent) {
  return content.document ? { note: JSON.stringify(content.document), markdown_content: conversationDocumentMarkdown(content.document) } : plainTextContent(content.text);
}
