export function plainTextContent(text: string) {
  // This command accepts text, never caller-supplied HTML, block IDs, uploads or
  // embedded URLs. Encode text nodes so JSON-looking input stays literal text.
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return { note: JSON.stringify(lines.map(line => ({ type: 'paragraph', content: [{ type: 'text', text: line, styles: {} }] }))),
    markdown_content: lines.map(line => line.replace(/([\\`*_{}\[\]()#+\-.!|~>])/g, '\\$1').replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('\n\n') };
}

