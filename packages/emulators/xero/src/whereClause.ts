import { XeroWireError } from './core';

/**
 * The subset of Xero's `where` filter language the emulator models: equality and
 * inequality of a field (dotted paths such as `Contact.ContactID` allowed) against
 * a double-quoted string, combined with AND / OR and parentheses. Inside a string,
 * `\"` is a literal quote and `\\` a literal backslash, matching how the Alga
 * client escapes values.
 *
 * Anything outside this subset is answered the way live Xero answers an
 * unparseable filter (400 QueryParseException), so a client that starts sending a
 * new shape fails loudly instead of matching everything.
 */
export type WherePredicate = (record: Record<string, unknown>) => boolean;

type Token =
  | { kind: 'ident'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'op'; value: '==' | '!=' }
  | { kind: 'and' | 'or' | 'lparen' | 'rparen' };

function parseError(where: string, detail: string): XeroWireError {
  return new XeroWireError(400, {
    Type: 'QueryParseException',
    Title: 'Unsupported where clause',
    Status: 400,
    Detail: `Xero emulator cannot parse where clause "${where}": ${detail}`,
  });
}

function tokenize(where: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < where.length) {
    const ch = where[i];
    if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === '(') {
      tokens.push({ kind: 'lparen' });
      i += 1;
    } else if (ch === ')') {
      tokens.push({ kind: 'rparen' });
      i += 1;
    } else if (where.startsWith('==', i) || where.startsWith('!=', i)) {
      tokens.push({ kind: 'op', value: where.slice(i, i + 2) as '==' | '!=' });
      i += 2;
    } else if (ch === '"') {
      let value = '';
      i += 1;
      for (;;) {
        if (i >= where.length) throw parseError(where, 'unterminated string');
        const c = where[i];
        if (c === '\\' && i + 1 < where.length) {
          value += where[i + 1];
          i += 2;
        } else if (c === '"') {
          i += 1;
          break;
        } else {
          value += c;
          i += 1;
        }
      }
      tokens.push({ kind: 'string', value });
    } else {
      const match = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(where.slice(i));
      if (!match) throw parseError(where, `unexpected character '${ch}'`);
      const word = match[0];
      if (word.toUpperCase() === 'AND') tokens.push({ kind: 'and' });
      else if (word.toUpperCase() === 'OR') tokens.push({ kind: 'or' });
      else tokens.push({ kind: 'ident', value: word });
      i += word.length;
    }
  }
  return tokens;
}

function readField(record: Record<string, unknown>, path: string): unknown {
  let current: unknown = record;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function parseWhere(where: string): WherePredicate {
  const tokens = tokenize(where);
  let pos = 0;
  const peek = () => tokens[pos];

  const parseOr = (): WherePredicate => {
    const terms = [parseAnd()];
    while (peek()?.kind === 'or') {
      pos += 1;
      terms.push(parseAnd());
    }
    return terms.length === 1 ? terms[0] : (record) => terms.some((term) => term(record));
  };

  const parseAnd = (): WherePredicate => {
    const terms = [parseAtom()];
    while (peek()?.kind === 'and') {
      pos += 1;
      terms.push(parseAtom());
    }
    return terms.length === 1 ? terms[0] : (record) => terms.every((term) => term(record));
  };

  const parseAtom = (): WherePredicate => {
    const token = tokens[pos];
    if (token?.kind === 'lparen') {
      pos += 1;
      const inner = parseOr();
      if (tokens[pos]?.kind !== 'rparen') throw parseError(where, 'missing )');
      pos += 1;
      return inner;
    }
    const field = tokens[pos];
    const op = tokens[pos + 1];
    const value = tokens[pos + 2];
    if (field?.kind !== 'ident' || op?.kind !== 'op' || value?.kind !== 'string') {
      throw parseError(where, 'expected Field=="value"');
    }
    pos += 3;
    const path = field.value;
    const expected = value.value;
    return op.value === '=='
      ? (record) => readField(record, path) === expected
      : (record) => readField(record, path) !== expected;
  };

  const predicate = parseOr();
  if (pos !== tokens.length) throw parseError(where, 'unexpected trailing input');
  return predicate;
}
