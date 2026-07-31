const IMAGE_DATA_URI_RE = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi;
const SECRET_KEY_RE = /password|secret|token|api_key|authorization/i;

function normalizeWhitespace(text: string): string {
  return text
    .replace(IMAGE_DATA_URI_RE, ' ')
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
        const cleaned = value.replace(IMAGE_DATA_URI_RE, ' ');
        if (cleaned.trim()) {
          parts.push(cleaned);
        }
      }
      IMAGE_DATA_URI_RE.lastIndex = 0;
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
      const cleaned = value.replace(IMAGE_DATA_URI_RE, ' ');
      if (cleaned.trim()) {
        parts.push(cleaned);
      }
      IMAGE_DATA_URI_RE.lastIndex = 0;
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
