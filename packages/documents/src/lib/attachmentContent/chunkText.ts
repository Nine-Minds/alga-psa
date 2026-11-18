/** Decode text bytes: a BOM selects UTF-8/UTF-16, otherwise UTF-8. Line endings are normalised to \n. */
export function decodeText(bytes: Buffer): string {
  let text: string;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = bytes.subarray(2).toString('utf16le');
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2));
    swapped.swap16();
    text = swapped.toString('utf16le');
  } else if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    text = bytes.subarray(3).toString('utf8');
  } else {
    text = bytes.toString('utf8');
  }
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Split text into chunks of at most `max` characters, at line boundaries. A single line longer than
 * `max` is split mid-line (the only case a line is cut). Always returns at least one chunk.
 */
export function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let current = '';
  const flush = () => {
    if (current.length > 0) chunks.push(current);
    current = '';
  };
  for (const line of text.split('\n')) {
    const piece = line + '\n';
    if (piece.length > max) {
      flush();
      for (let i = 0; i < piece.length; i += max) chunks.push(piece.slice(i, i + max));
      continue;
    }
    if (current.length + piece.length > max) flush();
    current += piece;
  }
  flush();
  // The loop appended a trailing newline the source may not have had.
  if (!text.endsWith('\n')) {
    const last = chunks.length - 1;
    if (chunks[last].endsWith('\n') && chunks[last].length > 0) chunks[last] = chunks[last].slice(0, -1);
  }
  return chunks.length > 0 ? chunks : [''];
}
