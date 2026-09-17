/** The slice of OData the PBX clients use: $select, $top, $skip, $filter (comparisons joined by `and`), $orderby. */

export type Row = Record<string, unknown>;
type Query = Record<string, unknown>;

const OPERATORS: Record<string, (cmp: number) => boolean> = {
  eq: (c) => c === 0,
  ne: (c) => c !== 0,
  gt: (c) => c > 0,
  ge: (c) => c >= 0,
  lt: (c) => c < 0,
  le: (c) => c <= 0,
};

export class ODataError extends Error {}

function param(query: Query, name: string): string | undefined {
  const value = query[name];
  return typeof value === 'string' ? value : undefined;
}

function integer(query: Query, name: string): number | undefined {
  const raw = param(query, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new ODataError(`Invalid ${name}: ${raw}`);
  return value;
}

function literal(raw: string): unknown {
  if (/^'.*'$/.test(raw)) return raw.slice(1, -1).replace(/''/g, "'");
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function compare(left: unknown, right: unknown): number {
  if (typeof left === 'string' && typeof right === 'string') {
    const l = Date.parse(left);
    const r = Date.parse(right);
    if (!Number.isNaN(l) && !Number.isNaN(r)) return l - r;
    return left < right ? -1 : left > right ? 1 : 0;
  }
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
  if (left === right) return 0;
  return left == null ? -1 : right == null ? 1 : String(left) < String(right) ? -1 : 1;
}

/** `Field op value [and Field op value]*` — enough for SegmentStartTime/StartTime windows. */
export function parseFilter(filter: string | undefined): (row: Row) => boolean {
  if (!filter?.trim()) return () => true;
  const clauses = filter.split(/\s+and\s+/i).map((clause) => {
    const match = clause.trim().match(/^([A-Za-z_][\w/]*)\s+(eq|ne|gt|ge|lt|le)\s+(.+)$/i);
    if (!match) throw new ODataError(`Unsupported $filter clause: ${clause}`);
    const [, field, op, raw] = match;
    return { field, test: OPERATORS[op.toLowerCase()], value: literal(raw.trim()) };
  });
  return (row) => clauses.every(({ field, test, value }) => test(compare(row[field], value)));
}

export function parseOrderBy(orderby: string | undefined): ((a: Row, b: Row) => number) | null {
  if (!orderby?.trim()) return null;
  const terms = orderby.split(',').map((term) => {
    const [field, direction = 'asc'] = term.trim().split(/\s+/);
    if (!field || !/^(asc|desc)$/i.test(direction)) throw new ODataError(`Unsupported $orderby: ${term}`);
    return { field, sign: direction.toLowerCase() === 'desc' ? -1 : 1 };
  });
  return (a, b) => {
    for (const { field, sign } of terms) {
      const c = compare(a[field], b[field]) * sign;
      if (c !== 0) return c;
    }
    return 0;
  };
}

export function applyQuery(rows: object[], query: Query): Row[] {
  let result = (rows as Row[]).filter(parseFilter(param(query, '$filter')));
  const order = parseOrderBy(param(query, '$orderby'));
  if (order) result = [...result].sort(order);
  const skip = integer(query, '$skip') ?? 0;
  const top = integer(query, '$top');
  result = result.slice(skip, top === undefined ? undefined : skip + top);
  const select = param(query, '$select');
  if (select) {
    const fields = select.split(',').map((f) => f.trim()).filter(Boolean);
    result = result.map((row) => Object.fromEntries(fields.map((f) => [f, row[f]])));
  }
  return result;
}
