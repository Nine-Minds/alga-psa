import { PREDICATE_OPERATORS, operatorTakesValue, validateClause } from '@alga-psa/predicates';
import type { PredicateClause, PredicateGroup, PredicateLiteral, PredicateOperator } from '@alga-psa/predicates';
import { ticketQuerySchema } from './ticketQuerySchema';
import { TICKET_WHERE_MAX_CLAUSES } from './ticketWhere';

/**
 * The URL form of a ticket `where`:
 *
 *     v1:<path>:<op>[:<value>,<value>...];<path>:<op>...
 *
 * The version prefix appears once; clauses are `;`-separated (a flat `and` group is the only shape
 * tickets store). Every component is percent-encoded, so path, operator and values never contain a
 * raw `:`, `;` or `,`. No base64, no second form. Bare `true` / `false` / `null` / numbers are those
 * literals; a string that would read as one is written with a leading `~` (a real leading `~` is
 * `%7E`). Unknown versions and malformed clauses are dropped, and counted for the toast.
 */
export const TICKET_WHERE_URL_VERSION = 'v1';

const OPERATORS = new Set<string>(PREDICATE_OPERATORS);
const RESERVED_WORD = /^(true|false|null|-?\d+(\.\d+)?)$/;

const encodePart = (text: string): string => encodeURIComponent(text).replace(/~/g, '%7E');

function encodeLiteral(value: PredicateLiteral): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return RESERVED_WORD.test(value) ? `~${encodePart(value)}` : encodePart(value);
}

function decodeLiteral(raw: string): PredicateLiteral {
  if (raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return decodeURIComponent(raw.startsWith('~') ? raw.slice(1) : raw);
}

export function encodeTicketWhere(where: PredicateGroup | undefined): string {
  const clauses = (where?.clauses ?? []).filter((node): node is PredicateClause => 'path' in node);
  if (clauses.length === 0) return '';
  const body = clauses.map((clause) => {
    const head = `${encodePart(clause.path)}:${clause.operator}`;
    if (!operatorTakesValue(clause.operator) || clause.value === undefined) return head;
    const values = Array.isArray(clause.value) ? clause.value : [clause.value];
    return `${head}:${values.map(encodeLiteral).join(',')}`;
  });
  return `${TICKET_WHERE_URL_VERSION}:${body.join(';')}`;
}

export interface DecodedTicketWhere {
  where?: PredicateGroup;
  /** Clauses (or a whole unreadable value) that could not be applied. */
  dropped: number;
}

/**
 * Parses a `where` URL value. Never throws; anything unreadable is dropped and counted.
 * `validate: false` skips path/operator validation against the ticket query schema (structure only).
 */
export function decodeTicketWhere(raw: string | null | undefined): DecodedTicketWhere {
  if (!raw || raw.trim() === '') return { dropped: 0 };
  const prefix = `${TICKET_WHERE_URL_VERSION}:`;
  if (!raw.startsWith(prefix)) return { dropped: 1 };

  const clauses: PredicateClause[] = [];
  let dropped = 0;
  for (const chunk of raw.slice(prefix.length).split(';')) {
    if (chunk === '') continue;
    try {
      const [rawPath, operator, rawValues] = chunk.split(':');
      if (!rawPath || !operator || !OPERATORS.has(operator)) throw new Error('bad clause');
      const op = operator as PredicateOperator;
      const clause: PredicateClause = { path: decodeURIComponent(rawPath), operator: op };
      if (operatorTakesValue(op)) {
        if (rawValues === undefined) throw new Error('missing value');
        const values = rawValues.split(',').map(decodeLiteral);
        clause.value = values.length === 1 && !LIST_OPERATORS.has(op) ? values[0] : values;
      }
      if (validateClause(ticketQuerySchema, clause)) throw new Error('invalid clause');
      clauses.push(clause);
    } catch {
      dropped += 1;
    }
  }
  const capped = clauses.slice(0, TICKET_WHERE_MAX_CLAUSES);
  dropped += clauses.length - capped.length;
  return capped.length > 0 ? { where: { join: 'and', clauses: capped }, dropped } : { dropped };
}

const LIST_OPERATORS = new Set<string>(['in', 'not_in']);
