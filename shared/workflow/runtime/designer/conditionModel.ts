import jsonata from 'jsonata';
import { normalizeExpressionSource } from '../expressionEngine';

/**
 * Structured form of a workflow condition (an If step's `condition.$expr`).
 *
 * The expression stays the single source of truth: the designer's condition builder parses the
 * expression into this model, edits the model, and serializes it back. Conditions that don't fit
 * the model (mixed and/or, nested groups, arbitrary functions) parse to `null`, and the designer
 * falls back to editing the raw expression.
 */
export type WorkflowConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'in'
  | 'not_in'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_empty'
  | 'is_not_empty';

export type WorkflowConditionLiteral = string | number | boolean | null;

export type WorkflowConditionClause = {
  /** Field path such as `vars.ticket.ticket.priority_id` or `payload.ticketId`. */
  path: string;
  operator: WorkflowConditionOperator;
  /** A literal for single-value operators, a list for `in`/`not_in`, absent for `is_empty`/`is_not_empty`. */
  value?: WorkflowConditionLiteral | WorkflowConditionLiteral[];
};

export type WorkflowConditionGroup = {
  join: 'and' | 'or';
  clauses: WorkflowConditionClause[];
};

export const WORKFLOW_CONDITION_OPERATORS: readonly WorkflowConditionOperator[] = [
  'equals',
  'not_equals',
  'in',
  'not_in',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'starts_with',
  'ends_with',
  'is_empty',
  'is_not_empty',
];

export const conditionOperatorTakesValue = (operator: WorkflowConditionOperator): boolean =>
  operator !== 'is_empty' && operator !== 'is_not_empty';

export const conditionOperatorTakesList = (operator: WorkflowConditionOperator): boolean =>
  operator === 'in' || operator === 'not_in';

const COMPARISON_OPERATOR_SYMBOLS: Partial<Record<WorkflowConditionOperator, string>> = {
  equals: '=',
  not_equals: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

const SYMBOL_TO_COMPARISON_OPERATOR: Record<string, WorkflowConditionOperator> = {
  '=': 'equals',
  '!=': 'not_equals',
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
};

const TEXT_FUNCTION_BY_OPERATOR: Partial<Record<WorkflowConditionOperator, string>> = {
  contains: 'contains',
  starts_with: 'startsWith',
  ends_with: 'endsWith',
};

const OPERATOR_BY_TEXT_FUNCTION: Record<string, WorkflowConditionOperator> = {
  contains: 'contains',
  startsWith: 'starts_with',
  endsWith: 'ends_with',
};

const SIMPLE_PATH_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const serializePath = (path: string): string => {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error('Condition field path is empty');
  }
  return trimmed
    .split('.')
    .map((segment) => (SIMPLE_PATH_SEGMENT.test(segment) ? segment : `\`${segment.replace(/`/g, '')}\``))
    .join('.');
};

const serializeLiteral = (value: WorkflowConditionLiteral): string => {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Condition value ${value} is not a finite number`);
    }
    return String(value);
  }
  return JSON.stringify(value);
};

const asSingleLiteral = (value: WorkflowConditionClause['value']): WorkflowConditionLiteral => {
  if (Array.isArray(value)) return value[0] ?? '';
  return value === undefined ? '' : value;
};

const asLiteralList = (value: WorkflowConditionClause['value']): WorkflowConditionLiteral[] => {
  if (Array.isArray(value)) return value;
  return value === undefined || value === '' ? [] : [value];
};

export const serializeConditionClause = (clause: WorkflowConditionClause): string => {
  const path = serializePath(clause.path);
  const comparison = COMPARISON_OPERATOR_SYMBOLS[clause.operator];
  if (comparison) {
    return `${path} ${comparison} ${serializeLiteral(asSingleLiteral(clause.value))}`;
  }

  const textFunction = TEXT_FUNCTION_BY_OPERATOR[clause.operator];
  if (textFunction) {
    return `${textFunction}(${path}, ${serializeLiteral(asSingleLiteral(clause.value))})`;
  }

  switch (clause.operator) {
    case 'in':
      return `${path} in [${asLiteralList(clause.value).map(serializeLiteral).join(', ')}]`;
    case 'not_in':
      return `(${path} in [${asLiteralList(clause.value).map(serializeLiteral).join(', ')}]) = false`;
    case 'is_empty':
      return `coalesce(${path}, "") = ""`;
    case 'is_not_empty':
      return `coalesce(${path}, "") != ""`;
    default:
      throw new Error(`Unsupported condition operator: ${String(clause.operator)}`);
  }
};

/** Serializes a condition group to a workflow expression. An empty group serializes to ''. */
export const serializeConditionGroup = (group: WorkflowConditionGroup): string =>
  group.clauses.map(serializeConditionClause).join(` ${group.join} `);

type AstNode = {
  type?: string;
  value?: unknown;
  lhs?: AstNode;
  rhs?: AstNode;
  steps?: AstNode[];
  stages?: unknown[];
  predicate?: unknown[];
  expressions?: AstNode[];
  arguments?: AstNode[];
  procedure?: AstNode;
  expression?: AstNode;
};

const readPath = (node: AstNode | undefined): string | null => {
  if (!node || node.type !== 'path' || !Array.isArray(node.steps) || node.steps.length === 0) return null;
  const segments: string[] = [];
  for (const step of node.steps) {
    if (step.type !== 'name' || typeof step.value !== 'string') return null;
    if ((step.stages?.length ?? 0) > 0 || (step.predicate?.length ?? 0) > 0) return null;
    segments.push(step.value);
  }
  return segments.join('.');
};

const NO_LITERAL = Symbol('no-literal');

const readLiteral = (node: AstNode | undefined): WorkflowConditionLiteral | typeof NO_LITERAL => {
  if (!node) return NO_LITERAL;
  if (node.type === 'string' && typeof node.value === 'string') return node.value;
  if (node.type === 'number' && typeof node.value === 'number') return node.value;
  if (node.type === 'value' && (node.value === true || node.value === false || node.value === null)) {
    return node.value as boolean | null;
  }
  if (node.type === 'unary' && node.value === '-' && node.expression?.type === 'number') {
    return -(node.expression.value as number);
  }
  return NO_LITERAL;
};

const readLiteralList = (node: AstNode | undefined): WorkflowConditionLiteral[] | null => {
  if (!node || node.type !== 'unary' || node.value !== '[' || !Array.isArray(node.expressions)) return null;
  const values: WorkflowConditionLiteral[] = [];
  for (const expression of node.expressions) {
    const literal = readLiteral(expression);
    if (literal === NO_LITERAL) return null;
    values.push(literal);
  }
  return values;
};

const readFunctionName = (node: AstNode | undefined): string | null => {
  if (!node || node.type !== 'function' || node.procedure?.type !== 'variable') return null;
  return typeof node.procedure.value === 'string' ? node.procedure.value : null;
};

const unwrapBlock = (node: AstNode | undefined): AstNode | undefined => {
  if (node?.type === 'block' && node.expressions?.length === 1) return unwrapBlock(node.expressions[0]);
  return node;
};

const readInClause = (node: AstNode | undefined): { path: string; values: WorkflowConditionLiteral[] } | null => {
  const inner = unwrapBlock(node);
  if (!inner || inner.type !== 'binary' || inner.value !== 'in') return null;
  const path = readPath(inner.lhs);
  const values = readLiteralList(inner.rhs);
  return path && values ? { path, values } : null;
};

const readClause = (rawNode: AstNode): WorkflowConditionClause | null => {
  const node = unwrapBlock(rawNode);
  if (!node) return null;

  if (node.type === 'binary' && typeof node.value === 'string') {
    if (node.value === 'in') {
      const inClause = readInClause(node);
      return inClause ? { path: inClause.path, operator: 'in', value: inClause.values } : null;
    }

    const comparison = SYMBOL_TO_COMPARISON_OPERATOR[node.value];
    if (!comparison) return null;

    const rhs = readLiteral(node.rhs);
    if (rhs === NO_LITERAL) return null;

    // (path in [...]) = false
    if (comparison === 'equals' && rhs === false) {
      const inClause = readInClause(node.lhs);
      if (inClause) return { path: inClause.path, operator: 'not_in', value: inClause.values };
    }

    // coalesce(path, "") = "" / != ""
    if ((comparison === 'equals' || comparison === 'not_equals') && rhs === '') {
      const lhs = unwrapBlock(node.lhs);
      if (readFunctionName(lhs) === 'coalesce' && lhs?.arguments?.length === 2 && readLiteral(lhs.arguments[1]) === '') {
        const path = readPath(lhs.arguments[0]);
        if (path) return { path, operator: comparison === 'equals' ? 'is_empty' : 'is_not_empty' };
      }
    }

    const path = readPath(unwrapBlock(node.lhs));
    if (!path) return null;
    return { path, operator: comparison, value: rhs };
  }

  const functionName = readFunctionName(node);
  if (functionName && OPERATOR_BY_TEXT_FUNCTION[functionName] && node.arguments?.length === 2) {
    const path = readPath(unwrapBlock(node.arguments[0]));
    const value = readLiteral(node.arguments[1]);
    if (!path || value === NO_LITERAL) return null;
    return { path, operator: OPERATOR_BY_TEXT_FUNCTION[functionName], value };
  }

  return null;
};

const collectJoinedClauses = (node: AstNode, join: 'and' | 'or', into: AstNode[]): boolean => {
  const inner = unwrapBlock(node);
  if (!inner) return false;
  if (inner.type === 'binary' && (inner.value === 'and' || inner.value === 'or')) {
    if (inner.value !== join) return false;
    return collectJoinedClauses(inner.lhs as AstNode, join, into)
      && collectJoinedClauses(inner.rhs as AstNode, join, into);
  }
  into.push(inner);
  return true;
};

/**
 * Parses a workflow expression into a condition group. Returns an empty `and` group for an empty
 * expression and `null` when the expression can't be represented (including syntax errors).
 */
export const parseConditionExpression = (source: string | null | undefined): WorkflowConditionGroup | null => {
  const trimmed = (source ?? '').trim();
  if (!trimmed) return { join: 'and', clauses: [] };

  let ast: AstNode;
  try {
    ast = jsonata(normalizeExpressionSource(trimmed)).ast() as AstNode;
  } catch {
    return null;
  }

  const root = unwrapBlock(ast);
  const join: 'and' | 'or' = root?.type === 'binary' && root.value === 'or' ? 'or' : 'and';
  const clauseNodes: AstNode[] = [];
  if (!root || !collectJoinedClauses(root, join, clauseNodes)) return null;

  const clauses: WorkflowConditionClause[] = [];
  for (const clauseNode of clauseNodes) {
    const clause = readClause(clauseNode);
    if (!clause) return null;
    clauses.push(clause);
  }
  return { join, clauses };
};
