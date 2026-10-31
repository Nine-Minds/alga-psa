import type { Knex } from 'knex';
import {
  PredicateSchemaError,
  attributeValueType,
  resolvePath,
  tenantColumnOf,
  validateClause,
} from '../querySchema';
import type { Attribute, QuerySchema, Relation, SetAttribute, SqlFragment } from '../querySchema';
import { isPredicateGroup } from '../types';
import type { PredicateClause, PredicateGroup, PredicateLiteral, PredicateNode, PredicateOperator } from '../types';

export interface CompileOptions {
  /** Alias of the schema's root table in the query the fragment is added to. */
  rootAlias: string;
  /**
   * Apply the "self or any child" rule (see `QuerySchema.children`) to every clause that crosses a
   * relation hop or reads a set attribute. Requires `schema.children`.
   */
  selfOrAnyChild?: boolean;
}

const TRUE: SqlFragment = { sql: 'TRUE', bindings: [] };
const FALSE: SqlFragment = { sql: 'FALSE', bindings: [] };

const and = (parts: SqlFragment[]): SqlFragment => {
  const kept = parts.filter((part) => part !== TRUE);
  if (kept.some((part) => part === FALSE)) return FALSE;
  if (kept.length === 0) return TRUE;
  if (kept.length === 1) return kept[0];
  return { sql: kept.map((part) => `(${part.sql})`).join(' AND '), bindings: kept.flatMap((part) => part.bindings) };
};

const or = (parts: SqlFragment[]): SqlFragment => {
  const kept = parts.filter((part) => part !== FALSE);
  if (kept.some((part) => part === TRUE)) return TRUE;
  if (kept.length === 0) return FALSE;
  if (kept.length === 1) return kept[0];
  return { sql: kept.map((part) => `(${part.sql})`).join(' OR '), bindings: kept.flatMap((part) => part.bindings) };
};

const not = (part: SqlFragment): SqlFragment =>
  part === TRUE ? FALSE : part === FALSE ? TRUE : { sql: `NOT (${part.sql})`, bindings: part.bindings };

const COMPLEMENT: Partial<Record<PredicateOperator, PredicateOperator>> = {
  not_in: 'in',
  is_empty: 'is_not_empty',
};

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (character) => `\\${character}`);

class Compiler {
  private aliasCounter = 0;

  constructor(
    private readonly schema: QuerySchema,
    private readonly options: CompileOptions,
  ) {}

  private nextAlias(): string {
    this.aliasCounter += 1;
    return `__p${this.aliasCounter}`;
  }

  private constantFilters(alias: string, where: Record<string, string | number | boolean> | undefined): SqlFragment[] {
    return Object.entries(where ?? {}).map(([column, value]) => ({
      sql: '?? = ?',
      bindings: [`${alias}.${column}`, value],
    }));
  }

  private correlation(
    childAlias: string,
    parentAlias: string,
    childColumn: string,
    parentColumn: string,
  ): SqlFragment[] {
    const tenant = tenantColumnOf(this.schema);
    return [
      { sql: '?? = ??', bindings: [`${childAlias}.${tenant}`, `${parentAlias}.${tenant}`] },
      { sql: '?? = ??', bindings: [`${childAlias}.${childColumn}`, `${parentAlias}.${parentColumn}`] },
    ];
  }

  private literalBinding(value: PredicateLiteral, attribute: Attribute): SqlFragment {
    return attributeValueType(attribute) === 'timestamp'
      ? { sql: '?::timestamptz', bindings: [value] }
      : { sql: '?', bindings: [value] };
  }

  /** Two-valued boolean for a scalar column. `operator` is never a complement operator here. */
  private columnPredicate(
    alias: string,
    column: string,
    attribute: Attribute,
    clause: PredicateClause,
    operator: PredicateOperator,
  ): SqlFragment {
    const ref = '??';
    const colBinding = `${alias}.${column}`;
    const type = attributeValueType(attribute);
    const list = Array.isArray(clause.value) ? clause.value : clause.value === undefined ? [] : [clause.value];
    const one = Array.isArray(clause.value) ? clause.value[0] : clause.value;
    const bind = (value: PredicateLiteral) => this.literalBinding(value, attribute);

    switch (operator) {
      case 'is_not_empty':
        return type === 'string'
          ? attribute.kind === 'column' && attribute.castToText
            ? { sql: `${ref} IS NOT NULL AND ${ref}::text <> ''`, bindings: [colBinding, colBinding] }
            : { sql: `${ref} IS NOT NULL AND ${ref} <> ''`, bindings: [colBinding, colBinding] }
          : { sql: `${ref} IS NOT NULL`, bindings: [colBinding] };
      case 'in': {
        if (list.length === 0) return FALSE;
        const marks = list.map((value) => bind(value));
        return {
          sql: `COALESCE(${ref} IN (${marks.map((mark) => mark.sql).join(', ')}), FALSE)`,
          bindings: [colBinding, ...marks.flatMap((mark) => mark.bindings)],
        };
      }
      case 'equals':
      case 'not_equals':
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        if (one === null || one === undefined) {
          // Comparing against null asks "is there a value" (see SEMANTICS.md).
          if (operator === 'equals') return not(this.columnPredicate(alias, column, attribute, clause, 'is_not_empty'));
          if (operator === 'not_equals') return this.columnPredicate(alias, column, attribute, clause, 'is_not_empty');
          return FALSE;
        }
        const symbol = { equals: '=', not_equals: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[operator];
        const mark = bind(one);
        return { sql: `COALESCE(${ref} ${symbol} ${mark.sql}, FALSE)`, bindings: [colBinding, ...mark.bindings] };
      }
      case 'contains':
      case 'starts_with':
      case 'ends_with': {
        const text = escapeLike(String(one ?? ''));
        const pattern = operator === 'contains' ? `%${text}%` : operator === 'starts_with' ? `${text}%` : `%${text}`;
        return { sql: `COALESCE(${ref} LIKE ? ESCAPE '\\', FALSE)`, bindings: [colBinding, pattern] };
      }
      default:
        throw new PredicateSchemaError(`Operator ${operator} is not compilable on a column`, 'operator_not_allowed', clause.path);
    }
  }

  private setPredicate(
    alias: string,
    attribute: SetAttribute,
    clause: PredicateClause,
    operator: PredicateOperator,
  ): SqlFragment {
    const child = this.nextAlias();
    const conditions = [
      ...this.correlation(child, alias, attribute.foreign, attribute.local),
      ...this.constantFilters(child, attribute.where),
    ];
    if (operator === 'in') {
      const list = Array.isArray(clause.value) ? clause.value : [];
      if (list.length === 0) return FALSE;
      conditions.push({
        sql: `?? IN (${list.map(() => '?').join(', ')})`,
        bindings: [`${child}.${attribute.valueColumn}`, ...list],
      });
    }
    const where = and(conditions);
    return {
      sql: `EXISTS (SELECT 1 FROM ?? AS ?? WHERE ${where.sql})`,
      bindings: [attribute.table, child, ...where.bindings],
    };
  }

  /**
   * Two-valued truth of `operator` for the path, evaluated against the row aliased `rootAlias`
   * (the root table or, for the bundle rule, a child of it). Complements are the caller's job.
   */
  private positive(rootAlias: string, clause: PredicateClause, operator: PredicateOperator): SqlFragment {
    const resolved = resolvePath(this.schema, clause.path);
    if (!resolved) throw new PredicateSchemaError(`Unknown path ${clause.path}`, 'unknown_path', clause.path);

    // Walk relation hops, collecting the correlated chain.
    const chain: Array<{ relation: Relation; alias: string; conditions: SqlFragment[] }> = [];
    let parentAlias = rootAlias;
    for (const relation of resolved.hops) {
      const alias = this.nextAlias();
      chain.push({
        relation,
        alias,
        conditions: [
          ...this.correlation(alias, parentAlias, relation.foreign, relation.local),
          ...(relation.correlate ?? []).map(({ local, foreign }) => ({ sql: '?? = ??', bindings: [`${alias}.${foreign}`, `${parentAlias}.${local}`] })),
          ...this.constantFilters(alias, relation.where),
        ],
      });
      parentAlias = alias;
    }

    const attribute = resolved.attribute;
    let leaf: SqlFragment;
    switch (attribute.kind) {
      case 'column':
        leaf = this.columnPredicate(parentAlias, attribute.column, attribute, clause, operator);
        break;
      case 'set':
        leaf = this.setPredicate(parentAlias, attribute, clause, operator);
        break;
      case 'computed':
        leaf = attribute.resolve({ alias: parentAlias, operator, value: clause.value });
        break;
    }

    // Wrap innermost-out: EXISTS (hop N ... AND leaf), nested through every hop.
    let inner = leaf;
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const { relation, alias, conditions } = chain[index];
      const where = and([...conditions, inner]);
      inner = {
        sql: `EXISTS (SELECT 1 FROM ?? AS ?? WHERE ${where.sql})`,
        bindings: [relation.table, alias, ...where.bindings],
      };
    }
    return inner;
  }

  private crossesRelation(clause: PredicateClause): boolean {
    const resolved = resolvePath(this.schema, clause.path);
    return !!resolved && (resolved.hops.length > 0 || resolved.attribute.kind === 'set');
  }

  private clause(clause: PredicateClause): SqlFragment {
    const issue = validateClause(this.schema, clause);
    if (issue) throw new PredicateSchemaError(issue.message, issue.code, issue.path);

    const complement = COMPLEMENT[clause.operator];
    const operator = complement ?? clause.operator;
    const rootAlias = this.options.rootAlias;

    let truth = this.positive(rootAlias, clause, operator);
    if (this.options.selfOrAnyChild && this.crossesRelation(clause)) {
      const children = this.schema.children;
      if (!children) {
        throw new PredicateSchemaError('selfOrAnyChild requires schema.children', 'unknown_path', clause.path);
      }
      const childAlias = this.nextAlias();
      const childTruth = this.positive(childAlias, clause, operator);
      const where = and([...this.correlation(childAlias, rootAlias, children.childColumn, children.parentColumn), childTruth]);
      truth = or([
        truth,
        {
          sql: `EXISTS (SELECT 1 FROM ?? AS ?? WHERE ${where.sql})`,
          bindings: [this.schema.table, childAlias, ...where.bindings],
        },
      ]);
    }
    return complement ? not(truth) : truth;
  }

  node(node: PredicateNode): SqlFragment {
    if (!isPredicateGroup(node)) return this.clause(node);
    const parts = node.clauses.map((child) => this.node(child));
    return node.join === 'and' ? and(parts) : or(parts);
  }
}

/** Compiles a predicate into a two-valued SQL boolean fragment. Throws `PredicateSchemaError` on invalid input. */
export const compilePredicateFragment = (
  schema: QuerySchema,
  predicate: PredicateNode,
  options: CompileOptions,
): SqlFragment => {
  const fragment = new Compiler(schema, options).node(predicate);
  // Parenthesized so the fragment is safe to AND/OR into any surrounding WHERE: a bare top-level
  // `a OR b` would otherwise bind looser than the caller's tenant scope.
  return fragment === TRUE || fragment === FALSE ? fragment : { sql: `(${fragment.sql})`, bindings: fragment.bindings };
};

/** Compiles a predicate into a knex raw boolean expression for `whereRaw`. */
export const compilePredicate = (
  knex: Knex | Knex.Transaction,
  schema: QuerySchema,
  predicate: PredicateGroup | PredicateClause,
  options: CompileOptions,
): Knex.Raw => {
  const fragment = compilePredicateFragment(schema, predicate, options);
  return knex.raw(fragment.sql, fragment.bindings as Knex.RawBinding[]);
};
