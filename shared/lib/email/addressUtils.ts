export interface ParsedEmailAddress {
  email: string;
  name?: string;
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+/i;

function trimWrapperCharacters(value: string): string {
  return value.replace(/^[\s"'(<]+/, '').replace(/[\s"')>,;:]+$/, '');
}

function normalizeDisplayName(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().replace(/^["']+|["']+$/g, '');
  return normalized || undefined;
}

function splitAddressHeader(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  let angleDepth = 0;
  let previous = '';

  for (const char of value) {
    if (char === '"' && previous !== '\\') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && char === '<') {
      angleDepth += 1;
    } else if (!inQuotes && char === '>' && angleDepth > 0) {
      angleDepth -= 1;
    }

    if ((char === ',' || char === ';') && !inQuotes && angleDepth === 0) {
      const trimmed = current.trim();
      if (trimmed) {
        parts.push(trimmed);
      }
      current = '';
      previous = char;
      continue;
    }

    current += char;
    previous = char;
  }

  const trailing = current.trim();
  if (trailing) {
    parts.push(trailing);
  }

  return parts;
}

export function parseEmailAddress(value?: string | null): ParsedEmailAddress | null {
  if (typeof value !== 'string') {
    return null;
  }

  let candidate = value.trim();
  if (!candidate) {
    return null;
  }

  candidate = candidate.replace(/^mailto:/i, '').trim();

  const angleMatch = candidate.match(/^(.*)<([^>]+)>.*$/);
  if (angleMatch) {
    const inner = trimWrapperCharacters(angleMatch[2] || '');
    const match = inner.match(EMAIL_PATTERN);
    if (match) {
      const email = trimWrapperCharacters(match[0]).toLowerCase();
      if (email.includes('@')) {
        return {
          email,
          name: normalizeDisplayName(angleMatch[1]),
        };
      }
    }
  }

  const emailMatch = candidate.match(EMAIL_PATTERN);
  if (!emailMatch) {
    return null;
  }

  const email = trimWrapperCharacters(emailMatch[0]).toLowerCase();
  if (!email || !email.includes('@')) {
    return null;
  }

  const prefix = candidate.slice(0, emailMatch.index ?? 0).trim();
  const name = prefix ? normalizeDisplayName(prefix) : undefined;

  return {
    email,
    name,
  };
}

export function normalizeEmailAddress(value?: string | null): string | null {
  return parseEmailAddress(value)?.email ?? null;
}

export function parseEmailAddressList(value?: string | null): ParsedEmailAddress[] {
  if (typeof value !== 'string') {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  return splitAddressHeader(trimmed)
    .map((entry) => parseEmailAddress(entry))
    .filter((entry): entry is ParsedEmailAddress => Boolean(entry));
}
