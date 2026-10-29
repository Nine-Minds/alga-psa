import { SET_OPERATORS, isPredicateGroup, operatorTakesList, operatorTakesValue } from './types';
import type { PredicateClause, PredicateLiteral, PredicateNode, PredicateOperator } from './types';

export type AttributeType = 'string' | 'number' | 'boolean' | 'uuid' | 'timestamp';

/** A fragment of SQL with positional `?` bindings and `??` identifier bindings (knex syntax). */
export interface SqlFragment {
  sql: string;
  bindings: unknown[];
}

export interface ColumnAttribute {
  kind: 'column';
  /** Column on the table of the level that declares the attribute. */
  column: string;
  type: AttributeType;
  /** Restrict the operators allowed for this attribute. Defaults to the operators valid for `type`. */
  operators?: readonly PredicateOperator[];
  /**
   * The column is a string-valued type that rejects `''` (a Postgres enum): emptiness tests compare
   * `column::text` so the "empty string counts as empty" rule still holds without a cast error.
   */
  castToText?: boolean;
}

/** Values held by child rows: a set-valued path (`tags`). */
export interface SetAttribute {
  kind: 'set';
  table: string;
  /** Column on the declaring level's table. */
  local: string;
  /** Column on `table` that points back to `local`. */
  foreign: string;
  /** Column on `table` that holds the element value. */
  valueColumn: string;
  valueType: AttributeType;
  /** Constant equality filters on `table`, for example `{ tagged_type: 'contact' }`. */
  where?: Record<string, string | number | boolean>;
}

export interface ComputedResolverContext {
  /** Alias of the declaring level's table in the query being built. */
  alias: string;
  /** Always a non-complement operator: the compiler resolves `not_in` and `is_empty` by negation. */
  operator: PredicateOperator;
  value?: PredicateLiteral | PredicateLiteral[];
}

/**
 * The only place raw SQL is allowed in a query schema. A resolver returns a two-valued boolean
 * (never NULL) for the positive form of the operator, and correlates every table it touches on tenant.
 */
export interface ComputedAttribute {
  kind: 'computed';
  /** Unique, stable name; every computed attribute has its own tests. */
  name: string;
  type: AttributeType;
  /** Operators exposed to callers. */
  operators: readonly PredicateOperator[];
  resolve: (context: ComputedResolverContext) => SqlFragment;
}

export type Attribute = ColumnAttribute | SetAttribute | ComputedAttribute;

export interface Relation {
  /** `one`: at most one related row. `many`: any number of related rows (clauses mean "some row"). */
  kind: 'one' | 'many';
  table: string;
  /** Column on the declaring level's table. */
  local: string;
  /** Column on `table` that matches `local`. */
  foreign: string;
  /** Additional equality keys relating this row to its parent. */
  correlate?: ReadonlyArray<{ local: string; foreign: string }>;
  where?: Record<string, string | number | boolean>;
  attributes: Record<string, Attribute>;
  relations?: Record<string, Relation>;
}

export interface QuerySchema {
  table: string;
  /** Column that scopes every row to a tenant; every compiled hop correlates on it. Default `tenant`. */
  tenantColumn?: string;
  attributes: Record<string, Attribute>;
  relations?: Record<string, Relation>;
  /**
   * Rows of the same table that hang under a parent row (ticket bundles). With the compile option
   * `selfOrAnyChild`, a clause that crosses a relation hop matches a row when it matches the row itself
   * or any child.
   */
  children?: {
    /** Column on the child row that holds the parent's `parentColumn`. */
    childColumn: string;
    parentColumn: string;
  };
}

export const tenantColumnOf = (schema: QuerySchema): string => schema.tenantColumn ?? 'tenant';

export const OPERATORS_BY_TYPE: Record<AttributeType, readonly PredicateOperator[]> = {
  string: ['equals', 'not_equals', 'in', 'not_in', 'contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
  number: ['equals', 'not_equals', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'],
  timestamp: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'],
  boolean: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  uuid: ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty'],
};

export interface ResolvedPath {
  /** Relations crossed from the root, in order. Empty for a root attribute. */
  hops: Relation[];
  hopNames: string[];
  attribute: Attribute;
}

export class PredicateSchemaError extends Error {
  constructor(
    message: string,
    readonly code: 'unknown_path' | 'operator_not_allowed' | 'bad_value',
    readonly path: string,
  ) {
    super(message);
    this.name = 'PredicateSchemaError';
  }
}

export const resolvePath = (schema: QuerySchema, path: string): ResolvedPath | null => {
  const segments = path.split('.');
  let attributes = schema.attributes;
  let relations = schema.relations ?? {};
  const hops: Relation[] = [];
  const hopNames: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isLast = index === segments.length - 1;
    if (isLast) {
      const attribute = Object.prototype.hasOwnProperty.call(attributes, segment) ? attributes[segment] : undefined;
      return attribute ? { hops, hopNames, attribute } : null;
    }
    const relation = Object.prototype.hasOwnProperty.call(relations, segment) ? relations[segment] : undefined;
    if (!relation) return null;
    hops.push(relation);
    hopNames.push(segment);
    attributes = relation.attributes;
    relations = relation.relations ?? {};
  }
  return null;
};

export const allowedOperators = (attribute: Attribute): readonly PredicateOperator[] => {
  switch (attribute.kind) {
    case 'set':
      return SET_OPERATORS;
    case 'computed':
      return attribute.operators;
    default:
      return attribute.operators ?? OPERATORS_BY_TYPE[attribute.type];
  }
};

export const attributeValueType = (attribute: Attribute): AttributeType =>
  attribute.kind === 'set' ? attribute.valueType : attribute.type;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const literalMatchesType = (value: unknown, type: AttributeType): boolean => {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'uuid':
      return typeof value === 'string' && UUID_PATTERN.test(value);
    case 'timestamp':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
  }
};

export interface ClauseIssue {
  path: string;
  code: 'unknown_path' | 'operator_not_allowed' | 'bad_value';
  message: string;
}

export const validateClause = (schema: QuerySchema, clause: PredicateClause): ClauseIssue | null => {
  const resolved = resolvePath(schema, clause.path);
  if (!resolved) return { path: clause.path, code: 'unknown_path', message: `Unknown path ${clause.path}` };
  if (!allowedOperators(resolved.attribute).includes(clause.operator)) {
    return {
      path: clause.path,
      code: 'operator_not_allowed',
      message: `Operator ${clause.operator} is not allowed on ${clause.path}`,
    };
  }
  if (!operatorTakesValue(clause.operator)) {
    return clause.value === undefined
      ? null
      : { path: clause.path, code: 'bad_value', message: `${clause.operator} takes no value` };
  }
  const type = attributeValueType(resolved.attribute);
  const values = operatorTakesList(clause.operator)
    ? Array.isArray(clause.value)
      ? clause.value
      : null
    : Array.isArray(clause.value) || clause.value === undefined
      ? null
      : [clause.value];
  // `equals null` / `not_equals null` ask whether there is a value (SEMANTICS.md, Missing values #4).
  const nullAllowed = clause.operator === 'equals' || clause.operator === 'not_equals';
  if (!values || !values.every((value) => (value === null ? nullAllowed : literalMatchesType(value, type)))) {
    return { path: clause.path, code: 'bad_value', message: `Invalid value for ${clause.operator} on ${clause.path}` };
  }
  return null;
};

/** Returns every issue found in a predicate; an empty list means it is valid for the schema. */
export const validatePredicate = (schema: QuerySchema, node: PredicateNode): ClauseIssue[] => {
  if (!isPredicateGroup(node)) {
    const issue = validateClause(schema, node);
    return issue ? [issue] : [];
  }
  return node.clauses.flatMap((child) => validatePredicate(schema, child));
};
