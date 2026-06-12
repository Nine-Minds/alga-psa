export type CommandPaletteField =
  | 'ticket'
  | 'client'
  | 'contact'
  | 'project'
  | 'asset'
  | 'user'
  | 'nav'
  | 'action';

export interface CommandPaletteTerm {
  raw: string;
  value: string;
  field?: CommandPaletteField;
  exclude: boolean;
  phrase: boolean;
  wildcard: boolean;
  fuzzy: boolean;
  magic?: 'mine' | 'recent' | 'open';
  error?: 'leading-wildcard';
}

export interface ParsedCommandPaletteQuery {
  raw: string;
  terms: CommandPaletteTerm[];
  defaultOperator: 'OR';
  scopedOperator: 'AND';
}

const FIELD_ALIASES: Record<string, CommandPaletteField> = {
  ticket: 'ticket',
  t: 'ticket',
  client: 'client',
  c: 'client',
  contact: 'contact',
  project: 'project',
  p: 'project',
  asset: 'asset',
  a: 'asset',
  user: 'user',
  u: 'user',
  nav: 'nav',
  action: 'action',
};

const MAGIC_ALIASES: Record<string, 'mine' | 'recent' | 'open'> = {
  mine: 'mine',
  m: 'mine',
  recent: 'recent',
  rec: 'recent',
  open: 'open',
  o: 'open',
};

export function parseCommandPaletteQuery(input: string): ParsedCommandPaletteQuery {
  const tokens = tokenize(input.trim());
  const terms: CommandPaletteTerm[] = [];
  let excludeNext = false;

  for (const token of tokens) {
    if (/^AND$/i.test(token) || /^OR$/i.test(token)) {
      continue;
    }

    if (/^NOT$/i.test(token)) {
      excludeNext = true;
      continue;
    }

    const parsed = parseToken(token, excludeNext);
    terms.push(parsed);
    excludeNext = false;
  }

  return {
    raw: input,
    terms,
    defaultOperator: 'OR',
    scopedOperator: 'AND',
  };
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;

  for (const char of input) {
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }

    if (/\s/.test(char) && !quoted) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function parseToken(token: string, excludeNext: boolean): CommandPaletteTerm {
  let raw = token;
  let exclude = excludeNext;

  if (raw.startsWith('-')) {
    exclude = true;
    raw = raw.slice(1);
  }

  const sigilField = fieldFromSigil(raw);
  let field = sigilField?.field;
  if (sigilField) {
    raw = sigilField.value;
  }

  const scoped = raw.match(/^([^:]+):(.+)$/);
  if (scoped) {
    field = FIELD_ALIASES[scoped[1].toLowerCase()] ?? field;
    raw = scoped[2];
  }

  const phrase = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"');
  const unquoted = phrase ? raw.slice(1, -1) : raw;
  const fuzzy = unquoted.endsWith('~');
  const value = fuzzy ? unquoted.slice(0, -1) : unquoted;
  const wildcard = value.includes('*') || value.includes('?');
  const magic = value.startsWith('$') ? MAGIC_ALIASES[value.slice(1).toLowerCase()] : undefined;

  return {
    raw: token,
    value,
    field,
    exclude,
    phrase,
    wildcard,
    fuzzy,
    magic,
    error: value.startsWith('*') ? 'leading-wildcard' : undefined,
  };
}

function fieldFromSigil(token: string): { field: CommandPaletteField; value: string } | null {
  if (token.startsWith('>')) return { field: 'action', value: token.slice(1) };
  if (token.startsWith('/')) return { field: 'nav', value: token.slice(1) };
  if (token.startsWith('@')) return { field: 'user', value: token.slice(1) };
  if (token.startsWith('#')) return { field: 'ticket', value: token.slice(1) };
  return null;
}
