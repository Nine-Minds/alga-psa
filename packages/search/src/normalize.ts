// Only the (short) prefix is matched with a regex; the base64 payload is
// consumed by a linear scan. A single regex over the whole `data:image/...`
// span overflows V8's regex stack on multi-megabyte payloads (embedded images
// routinely exceed 10MB) — the failure surfaced under Node 24. The manual scan
// below strips the same spans in O(n) with no engine recursion.
const IMAGE_DATA_URI_PREFIX_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;
const SECRET_KEY_RE = /password|secret|token|api_key|authorization/i;

function isBase64PayloadCharCode(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) || // 0-9
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) || // a-z
    code === 0x2b || // +
    code === 0x2f || // /
    code === 0x3d || // =
    code === 0x20 || // space
    code === 0x09 || // tab
    code === 0x0a || // newline
    code === 0x0d || // carriage return
    code === 0x0c || // form feed
    code === 0x0b // vertical tab
  );
}

function stripImageDataUris(text: string): string {
  if (!text.includes('data:image/')) {
    return text;
  }

  let result = '';
  let cursor = 0;
  const length = text.length;

  while (cursor < length) {
    const start = text.indexOf('data:image/', cursor);
    if (start === -1) {
      result += text.slice(cursor);
      break;
    }

    result += text.slice(cursor, start);

    // The prefix (`data:image/<type>;base64,`) is short; bound the window.
    const prefixMatch = text.slice(start, start + 128).match(IMAGE_DATA_URI_PREFIX_RE);
    if (!prefixMatch) {
      result += text[start];
      cursor = start + 1;
      continue;
    }

    let end = start + prefixMatch[0].length;
    while (end < length && isBase64PayloadCharCode(text.charCodeAt(end))) {
      end += 1;
    }

    result += ' ';
    cursor = end;
  }

  return result;
}

function normalizeWhitespace(text: string): string {
  return stripImageDataUris(text)
    .replace(/\s+/g, ' ')
    .trim();
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function flattenBlockNote(json: unknown): string {
  const input = typeof json === 'string' ? safeParseJson(json) : json;
  if (typeof input === 'string') {
    return normalizeWhitespace(input);
  }

  const parts: string[] = [];
  const seen = new WeakSet<object>();

  const visit = (value: unknown, keyHint?: string): void => {
    if (typeof value === 'string') {
      if (keyHint === 'text' || keyHint === 'content') {
        const cleaned = stripImageDataUris(value);
        if (cleaned.trim()) {
          parts.push(cleaned);
        }
      }
      return;
    }

    if (!value || typeof value !== 'object') {
      return;
    }

    if (seen.has(value)) {
      return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') {
      visit(record.text, 'text');
    }
    if (typeof record.content === 'string') {
      visit(record.content, 'content');
    }

    for (const key of ['content', 'children', 'items']) {
      const child = record[key];
      if (child && typeof child === 'object') {
        visit(child, key);
      }
    }
  };

  visit(input);
  return normalizeWhitespace(parts.join(' '));
}

export function flattenMarkdown(md: string): string {
  return normalizeWhitespace(
    md
      .replace(/```[\w-]*\n?/g, '')
      .replace(/```/g, '')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '')
      .replace(/[*_~`]+/g, '')
      .replace(/<[^>]+>/g, ' '),
  );
}

export function flattenJsonbPayload(obj: unknown): string {
  if (!obj || typeof obj !== 'object') {
    return '';
  }

  const parts: string[] = [];
  const seen = new WeakSet<object>();

  const visit = (value: unknown, keyHint?: string): void => {
    if (keyHint && SECRET_KEY_RE.test(keyHint)) {
      return;
    }

    if (typeof value === 'string') {
      const cleaned = stripImageDataUris(value);
      if (cleaned.trim()) {
        parts.push(cleaned);
      }
      return;
    }

    if (!value || typeof value !== 'object') {
      return;
    }

    if (seen.has(value)) {
      return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      visit(child, key);
    }
  };

  visit(obj);
  return normalizeWhitespace(parts.join(' '));
}

export function truncateForIndex(text: string, maxBytes = 65_536): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text;
  }

  let output = '';
  let bytes = 0;
  for (const char of text) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (bytes + charBytes > maxBytes) {
      break;
    }
    output += char;
    bytes += charBytes;
  }
  return output;
}
