import jsonata from 'jsonata';
import { normalizeExpressionSource } from './expressionEngine';
import { WORKFLOW_EXPRESSION_FUNCTIONS } from './expressionFunctions';

/**
 * Static result-type inference for workflow `$expr` expressions.
 *
 * Parses the expression with the same JSONata parser the runtime uses and walks
 * the AST, so operators (`&`, comparisons, `and`/`or`, arithmetic, `? :`) and
 * function calls produce a type instead of only bare field paths. Field paths
 * are delegated to the caller, which knows the payload/vars schemas in scope.
 *
 * Types follow JSON Schema names (`integer` is folded into `number`). A result
 * containing `unknown` means the type could not be fully determined.
 */
export type WorkflowExpressionResultType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'array'
  | 'object'
  | 'unknown';

export type WorkflowExpressionPathSegment =
  | { kind: 'field'; name: string }
  /** A numeric index such as `items[0]`: selects one element of an array. */
  | { kind: 'index' };

/**
 * Resolves the types of a field path such as `payload.ticket.title`
 * (segments: payload, ticket, title). Return `unknown` when the path is not known.
 */
export type WorkflowExpressionPathTypeResolver = (
  segments: WorkflowExpressionPathSegment[]
) => Set<string>;

type AstNode = {
  type?: string;
  value?: unknown;
  lhs?: unknown;
  rhs?: unknown;
  steps?: AstNode[];
  stages?: AstNode[];
  expr?: AstNode;
  expression?: AstNode;
  expressions?: AstNode[];
  condition?: AstNode;
  then?: AstNode;
  else?: AstNode;
  arguments?: AstNode[];
  procedure?: AstNode;
  predicate?: unknown;
  group?: unknown;
  focus?: unknown;
  index?: unknown;
  tuple?: unknown;
  keepArray?: unknown;
};

const UNKNOWN = (): Set<string> => new Set(['unknown']);
const single = (type: WorkflowExpressionResultType): Set<string> => new Set([type]);

const STRING_OPERATORS = new Set(['&']);
const BOOLEAN_OPERATORS = new Set(['=', '!=', '<', '<=', '>', '>=', 'in', 'and', 'or']);
const NUMBER_OPERATORS = new Set(['+', '-', '*', '/', '%']);

/**
 * Return types of JSONata built-ins, kept so inference stays accurate if the
 * runtime allowlist grows (publish validation still rejects functions that are
 * not allowlisted). Workflow helper functions are typed from the `returns`
 * field of their catalog entry (see getFunctionReturnType).
 */
const FUNCTION_RETURN_TYPES: Record<string, WorkflowExpressionResultType> = {
  // JSONata string functions.
  string: 'string',
  uppercase: 'string',
  lowercase: 'string',
  trim: 'string',
  pad: 'string',
  substring: 'string',
  substringBefore: 'string',
  substringAfter: 'string',
  join: 'string',
  replace: 'string',
  base64encode: 'string',
  base64decode: 'string',
  encodeUrl: 'string',
  encodeUrlComponent: 'string',
  decodeUrl: 'string',
  decodeUrlComponent: 'string',
  formatNumber: 'string',
  formatBase: 'string',
  formatInteger: 'string',
  now: 'string',
  fromMillis: 'string',
  // JSONata numeric functions.
  number: 'number',
  length: 'number',
  abs: 'number',
  floor: 'number',
  ceil: 'number',
  round: 'number',
  power: 'number',
  sqrt: 'number',
  random: 'number',
  sum: 'number',
  max: 'number',
  min: 'number',
  average: 'number',
  count: 'number',
  millis: 'number',
  toMillis: 'number',
  parseInteger: 'number',
  // JSONata boolean functions.
  boolean: 'boolean',
  not: 'boolean',
  exists: 'boolean',
  contains: 'boolean',
  // JSONata array/object functions.
  split: 'array',
  keys: 'array',
  sort: 'array',
  reverse: 'array',
  distinct: 'array',
  zip: 'array',
  spread: 'array',
  merge: 'object',
};

const union = (...sets: Set<string>[]): Set<string> => {
  const result = new Set<string>();
  for (const set of sets) {
    for (const value of set) result.add(value);
  }
  return result.size > 0 ? result : UNKNOWN();
};

const withoutNull = (types: Set<string>): Set<string> => {
  const result = new Set(Array.from(types).filter((type) => type !== 'null'));
  return result.size > 0 ? result : UNKNOWN();
};

const normalizeResolvedTypes = (types: Set<string> | null | undefined): Set<string> => {
  if (!types || types.size === 0) return UNKNOWN();
  return new Set(Array.from(types).map((type) => (type === 'integer' ? 'number' : type)));
};

const CATALOG_RETURN_TYPES = new Map<string, WorkflowExpressionResultType>(
  WORKFLOW_EXPRESSION_FUNCTIONS.map((fn) => [fn.name, fn.returns === 'any' ? 'unknown' : fn.returns])
);

const getFunctionReturnType = (name: string): WorkflowExpressionResultType | undefined =>
  CATALOG_RETURN_TYPES.get(name) ?? FUNCTION_RETURN_TYPES[name];

const getFunctionName = (procedure: AstNode | undefined): string | null => {
  if (!procedure) return null;
  if ((procedure.type === 'variable' || procedure.type === 'name') && typeof procedure.value === 'string') {
    return procedure.value;
  }
  return null;
};

const isNumericIndexStage = (stage: AstNode): boolean =>
  stage.type === 'filter' && stage.expr?.type === 'number';

const toPathSegments = (node: AstNode): WorkflowExpressionPathSegment[] | null => {
  const steps = node.steps;
  if (!Array.isArray(steps) || steps.length === 0) return null;
  if (node.keepArray) return null;

  const segments: WorkflowExpressionPathSegment[] = [];
  for (const step of steps) {
    if (step.type !== 'name' || typeof step.value !== 'string') return null;
    if (step.predicate || step.group || step.focus || step.index || step.tuple || step.keepArray) return null;
    segments.push({ kind: 'field', name: step.value });
    for (const stage of step.stages ?? []) {
      if (!isNumericIndexStage(stage)) return null;
      segments.push({ kind: 'index' });
    }
  }
  return segments;
};

const inferNode = (node: AstNode | undefined, resolvePath: WorkflowExpressionPathTypeResolver): Set<string> => {
  if (!node || typeof node !== 'object') return UNKNOWN();

  switch (node.type) {
    case 'string':
      return single('string');
    case 'number':
      return single('number');
    case 'value':
      if (node.value === null) return single('null');
      if (typeof node.value === 'boolean') return single('boolean');
      return UNKNOWN();
    case 'binary': {
      const operator = String(node.value);
      if (STRING_OPERATORS.has(operator)) return single('string');
      if (BOOLEAN_OPERATORS.has(operator)) return single('boolean');
      if (NUMBER_OPERATORS.has(operator)) return single('number');
      if (operator === '..') return single('array');
      return UNKNOWN();
    }
    case 'unary': {
      const operator = String(node.value);
      if (operator === '-') return single('number');
      if (operator === '[') return single('array');
      if (operator === '{') return single('object');
      return UNKNOWN();
    }
    case 'condition': {
      const thenTypes = inferNode(node.then, resolvePath);
      // Without an else branch JSONata yields no value, which omits the field.
      return node.else ? union(thenTypes, inferNode(node.else, resolvePath)) : thenTypes;
    }
    case 'block': {
      const expressions = node.expressions ?? [];
      return expressions.length > 0 ? inferNode(expressions[expressions.length - 1], resolvePath) : UNKNOWN();
    }
    case 'bind':
      return inferNode(node.rhs as AstNode | undefined, resolvePath);
    case 'function': {
      const name = getFunctionName(node.procedure);
      if (!name) return UNKNOWN();
      if (name === 'coalesce') {
        // The first non-null argument wins, so only the last argument can contribute null.
        const args = node.arguments ?? [];
        if (args.length === 0) return single('null');
        return union(
          ...args.map((arg, index) => {
            const argTypes = inferNode(arg, resolvePath);
            return index < args.length - 1 ? withoutNull(argTypes) : argTypes;
          })
        );
      }
      const returnType = getFunctionReturnType(name);
      return returnType ? single(returnType) : UNKNOWN();
    }
    case 'apply': {
      const rhs = node.rhs as AstNode | undefined;
      if (rhs?.type === 'function') return inferNode(rhs, resolvePath);
      const name = getFunctionName(rhs);
      const returnType = name ? getFunctionReturnType(name) : undefined;
      return returnType ? single(returnType) : UNKNOWN();
    }
    case 'path': {
      const segments = toPathSegments(node);
      return segments ? normalizeResolvedTypes(resolvePath(segments)) : UNKNOWN();
    }
    case 'name':
      return typeof node.value === 'string'
        ? normalizeResolvedTypes(resolvePath([{ kind: 'field', name: node.value }]))
        : UNKNOWN();
    default:
      return UNKNOWN();
  }
};

/**
 * Infers the possible result types of a workflow expression. Unparseable
 * expressions infer as `unknown`; syntax errors are reported by
 * `validateExpressionSource`, not here.
 */
export function inferExpressionResultTypes(
  source: string,
  resolvePath: WorkflowExpressionPathTypeResolver
): Set<string> {
  const trimmed = String(source ?? '').trim();
  if (!trimmed) return UNKNOWN();

  let ast: AstNode;
  try {
    ast = jsonata(normalizeExpressionSource(trimmed)).ast() as AstNode;
  } catch {
    return UNKNOWN();
  }
  return inferNode(ast, resolvePath);
}
