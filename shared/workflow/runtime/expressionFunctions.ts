/**
 * Catalog of the custom functions available inside workflow `$expr`
 * expressions (on top of JSONata's built-ins). The expression engine
 * registers implementations from this catalog, so the metadata below can
 * never drift from what actually runs.
 */
export type WorkflowExpressionValueType = 'string' | 'number' | 'boolean' | 'array' | 'any';

export type WorkflowExpressionFunctionCategory = 'String' | 'Array' | 'Date' | 'Misc';

export type WorkflowExpressionFunctionParameter = {
  name: string;
  type: string;
  description: string;
  optional?: boolean;
};

export type WorkflowExpressionFunctionDef = {
  name: string;
  signature: string;
  description: string;
  example: string;
  /** Arguments, in order. Designer completion, signature help and hover read these. */
  parameters: readonly WorkflowExpressionFunctionParameter[];
  category: WorkflowExpressionFunctionCategory;
  /** Result type, used by designer type inference and validation. */
  returns: WorkflowExpressionValueType;
  implementation: (...args: never[]) => unknown;
};

/** Upper bound for the length/count arguments of the text functions, so they stay cheap. */
export const WORKFLOW_EXPRESSION_MAX_TEXT_LENGTH = 100_000;

const asText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : String(value);
};

/** A whole-number argument, clamped to [min, WORKFLOW_EXPRESSION_MAX_TEXT_LENGTH]. */
const asCount = (fn: string, argument: string, value: unknown, min: number): number => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(number)) {
    throw new Error(`${fn}: ${argument} must be a number`);
  }
  return Math.min(Math.max(Math.trunc(number), min), WORKFLOW_EXPRESSION_MAX_TEXT_LENGTH);
};

/** A UTF-16 surrogate code unit. Text without one has exactly one code unit per character. */
const SURROGATE = /[\uD800-\uDFFF]/;

/** Code units taken by the character at `offset`: 2 for a surrogate pair, otherwise 1. */
const characterWidth = (text: string, offset: number): number => {
  const code = text.charCodeAt(offset);
  if (code >= 0xd800 && code <= 0xdbff && offset + 1 < text.length) {
    const next = text.charCodeAt(offset + 1);
    if (next >= 0xdc00 && next <= 0xdfff) return 2;
  }
  return 1;
};

/**
 * Number of characters (code points, so emoji count once). Text with surrogate pairs is
 * counted no further than one past `limit`; callers only compare the result against it.
 * Indexed loops instead of `for...of` keep large text well inside the evaluation budget.
 */
const countCharacters = (text: string, limit: number): number => {
  if (!SURROGATE.test(text)) return text.length;
  let count = 0;
  for (let offset = 0; offset < text.length && count <= limit; offset += characterWidth(text, offset)) {
    count += 1;
  }
  return count;
};

/** Characters [start, end) of text, by code point, never splitting a surrogate pair. */
const sliceCharacters = (text: string, start: number, end?: number): string => {
  if (!SURROGATE.test(text)) return text.slice(start, end === undefined ? undefined : Math.max(start, end));
  let index = 0;
  let offset = 0;
  let startOffset: number | null = null;
  let endOffset = text.length;
  while (offset < text.length) {
    if (index === start) startOffset = offset;
    if (end !== undefined && index === end) {
      endOffset = offset;
      break;
    }
    offset += characterWidth(text, offset);
    index += 1;
  }
  if (startOffset === null) return '';
  return text.slice(startOffset, Math.max(startOffset, endOffset));
};

export const WORKFLOW_EXPRESSION_FUNCTIONS: readonly WorkflowExpressionFunctionDef[] = [
  {
    name: 'nowIso',
    signature: 'nowIso() -> string',
    description: 'Current timestamp as an ISO-8601 string.',
    example: '{ "$expr": "nowIso()" }',
    parameters: [],
    category: 'Date',
    returns: 'string',
    implementation: () => new Date().toISOString(),
  },
  {
    name: 'coalesce',
    signature: 'coalesce(...values) -> any',
    description: 'First argument that is neither null nor undefined, else null.',
    example: '{ "$expr": "coalesce(payload.nickname, payload.name, \\"unknown\\")" }',
    parameters: [
      { name: 'value1', type: 'any', description: 'First candidate value' },
      { name: 'value2', type: 'any', description: 'Fallback value' },
      { name: '...', type: 'any', description: 'More fallbacks', optional: true },
    ],
    category: 'Misc',
    returns: 'any',
    implementation: (...args: unknown[]) => {
      for (const arg of args) {
        if (arg !== null && arg !== undefined) return arg;
      }
      return null;
    },
  },
  {
    name: 'len',
    signature: 'len(value: string | array) -> number',
    description: 'Length of a string or array; 0 for anything else.',
    example: '{ "$expr": "len(payload.items) > 0" }',
    parameters: [{ name: 'value', type: 'string | array', description: 'Value to measure' }],
    category: 'Misc',
    returns: 'number',
    implementation: (value: unknown) => {
      if (typeof value === 'string' || Array.isArray(value)) {
        return value.length;
      }
      return 0;
    },
  },
  {
    name: 'toString',
    signature: 'toString(value) -> string',
    description: 'String form of any value; empty string for null/undefined.',
    example: '{ "$expr": "toString(payload.count) & \\" items\\"" }',
    parameters: [{ name: 'value', type: 'any', description: 'Value to convert' }],
    category: 'String',
    returns: 'string',
    implementation: (value: unknown) => {
      if (value === null || value === undefined) return '';
      return String(value);
    },
  },
  {
    name: 'append',
    signature: 'append(list, value) -> array',
    description:
      'Concatenate onto a list. Non-array lists are wrapped ([] for null/undefined); array values are spread.',
    example: '{ "$expr": "append(vars.seen, payload.ticketId)" }',
    parameters: [
      { name: 'list', type: 'array', description: 'List to add to' },
      { name: 'value', type: 'any', description: 'Value or list of values to add' },
    ],
    category: 'Array',
    returns: 'array',
    implementation: (list: unknown, value: unknown) => {
      const base = Array.isArray(list) ? list : list === null || list === undefined ? [] : [list];
      const toAdd = Array.isArray(value) ? value : [value];
      return base.concat(toAdd);
    },
  },
  {
    name: 'contains',
    signature: 'contains(text, part) -> boolean',
    description: 'True when text includes part (case-sensitive). False when either is missing.',
    example: '{ "$expr": "contains(payload.title, \\"outage\\")" }',
    parameters: [
      { name: 'text', type: 'string', description: 'Text to search' },
      { name: 'part', type: 'string', description: 'Text to look for' },
    ],
    category: 'String',
    returns: 'boolean',
    implementation: (text: unknown, part: unknown) => {
      const value = asText(text);
      const search = asText(part);
      return value !== null && search !== null && value.includes(search);
    },
  },
  {
    name: 'startsWith',
    signature: 'startsWith(text, prefix) -> boolean',
    description: 'True when text begins with prefix (case-sensitive). False when either is missing.',
    example: '{ "$expr": "startsWith(payload.subject, \\"RE:\\")" }',
    parameters: [
      { name: 'text', type: 'string', description: 'Text to check' },
      { name: 'prefix', type: 'string', description: 'Expected beginning' },
    ],
    category: 'String',
    returns: 'boolean',
    implementation: (text: unknown, prefix: unknown) => {
      const value = asText(text);
      const search = asText(prefix);
      return value !== null && search !== null && value.startsWith(search);
    },
  },
  {
    name: 'endsWith',
    signature: 'endsWith(text, suffix) -> boolean',
    description: 'True when text ends with suffix (case-sensitive). False when either is missing.',
    example: '{ "$expr": "endsWith(payload.email, \\"@example.com\\")" }',
    parameters: [
      { name: 'text', type: 'string', description: 'Text to check' },
      { name: 'suffix', type: 'string', description: 'Expected ending' },
    ],
    category: 'String',
    returns: 'boolean',
    implementation: (text: unknown, suffix: unknown) => {
      const value = asText(text);
      const search = asText(suffix);
      return value !== null && search !== null && value.endsWith(search);
    },
  },
  {
    name: 'lower',
    signature: 'lower(text) -> string',
    description: 'Text in lower case; empty string for null/undefined. Use it for case-insensitive comparisons.',
    example: '{ "$expr": "contains(lower(payload.title), \\"urgent\\")" }',
    parameters: [{ name: 'text', type: 'string', description: 'Text to convert' }],
    category: 'String',
    returns: 'string',
    implementation: (text: unknown) => (asText(text) ?? '').toLowerCase(),
  },
  {
    name: 'upper',
    signature: 'upper(text) -> string',
    description: 'Text in upper case; empty string for null/undefined.',
    example: '{ "$expr": "upper(payload.code)" }',
    parameters: [{ name: 'text', type: 'string', description: 'Text to convert' }],
    category: 'String',
    returns: 'string',
    implementation: (text: unknown) => (asText(text) ?? '').toUpperCase(),
  },
  {
    name: 'truncate',
    signature: 'truncate(text, length, ending?) -> string',
    description:
      'Text shortened to at most length characters, ending with "..." (or your own ending) when it was cut. Empty string for null/undefined.',
    example: '{ "$expr": "truncate(vars.ticket.latest_customer_comment.note, 140)" }',
    parameters: [
      { name: 'text', type: 'string', description: 'Text to shorten' },
      { name: 'length', type: 'number', description: 'Maximum number of characters, ending included' },
      { name: 'ending', type: 'string', description: 'Added when the text is cut; defaults to "..."', optional: true },
    ],
    category: 'String',
    returns: 'string',
    implementation: (text: unknown, length: unknown, ending?: unknown) => {
      const value = asText(text) ?? '';
      const max = asCount('truncate', 'length', length, 0);
      if (countCharacters(value, max) <= max) return value;
      const marker = ending === undefined ? '...' : asText(ending) ?? '';
      const markerLength = countCharacters(marker, max);
      if (markerLength >= max) return sliceCharacters(marker, 0, max);
      return sliceCharacters(value, 0, max - markerLength) + marker;
    },
  },
  {
    name: 'substring',
    signature: 'substring(text, start, length?) -> string',
    description:
      'Part of the text from start (0 is the first character; negative counts from the end), up to length characters. Empty string for null/undefined.',
    example: '{ "$expr": "substring(payload.subject, 0, 20)" }',
    parameters: [
      { name: 'text', type: 'string', description: 'Source text' },
      { name: 'start', type: 'number', description: 'First character, from 0; negative counts from the end' },
      { name: 'length', type: 'number', description: 'Number of characters; the rest of the text when left out', optional: true },
    ],
    category: 'String',
    returns: 'string',
    implementation: (text: unknown, start: unknown, length?: unknown) => {
      const value = asText(text) ?? '';
      let from = asCount('substring', 'start', start, -WORKFLOW_EXPRESSION_MAX_TEXT_LENGTH);
      if (from < 0) {
        from = Math.max(0, countCharacters(value, Number.POSITIVE_INFINITY) + from);
      }
      if (length === undefined || length === null) return sliceCharacters(value, from);
      const count = asCount('substring', 'length', length, 0);
      return sliceCharacters(value, from, from + count);
    },
  },
] as const;

export const WORKFLOW_RUNTIME_ALLOWED_FUNCTIONS = WORKFLOW_EXPRESSION_FUNCTIONS.map(
  (fn) => fn.name
) as readonly string[];

export type WorkflowRuntimeAllowedFunction = (typeof WORKFLOW_RUNTIME_ALLOWED_FUNCTIONS)[number];

/** Metadata-only view for API surfaces like the authoring guide. */
export type WorkflowExpressionFunctionInfo = Omit<WorkflowExpressionFunctionDef, 'implementation'>;

export function listWorkflowExpressionFunctions(): WorkflowExpressionFunctionInfo[] {
  return WORKFLOW_EXPRESSION_FUNCTIONS.map(({ implementation: _implementation, ...info }) => info);
}

/** The expression inside a catalog example (stored as `{ "$expr": "..." }` JSON for API consumers). */
export function getWorkflowExpressionExampleSource(fn: Pick<WorkflowExpressionFunctionInfo, 'example' | 'signature'>): string {
  try {
    const parsed = JSON.parse(fn.example) as { $expr?: unknown };
    return typeof parsed?.$expr === 'string' && parsed.$expr.trim() ? parsed.$expr : fn.signature;
  } catch {
    return fn.example.trim() || fn.signature;
  }
}
