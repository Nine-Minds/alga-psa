// QueryBuilder utility for constructing database queries from report definitions

import { Knex } from 'knex';
import { getTenantTableScope, parseTableExpression, tenantDb } from '@alga-psa/db';
import { 
  QueryDefinition, 
  ReportParameters, 
  FilterDefinition, 
  JoinDefinition,
  OrderDefinition,
  ReportExecutionError 
} from '../core/types';

export class QueryBuilder {
  
  /**
   * Build a Knex query from a QueryDefinition
   */
  static build(
    trx: Knex.Transaction,
    queryDef: QueryDefinition,
    parameters: ReportParameters
  ): Knex.QueryBuilder {

    try {
      // Handle raw SQL mode - when table is 'raw_sql', the SQL is in fields[0].
      // Placeholders must be written as {{paramName}} and are converted to bind parameters.
      if (queryDef.table === 'raw_sql') {
        const rawSql = queryDef.fields?.[0];
        if (!rawSql || typeof rawSql !== 'string') {
          throw new ReportExecutionError('Raw SQL mode requires SQL query in fields[0]');
        }

        return this.buildParameterizedRawSql(trx, rawSql, parameters);
      }

      let query = this.buildRootQuery(trx, queryDef, parameters);
      
      // Add joins
      if (queryDef.joins && queryDef.joins.length > 0) {
        for (const join of queryDef.joins) {
          query = this.applyJoin(trx, query, join, parameters);
        }
      }
      
      // Add field selection
      if (queryDef.fields && queryDef.fields.length > 0) {
        if (queryDef.aggregation) {
          // Handle aggregation with specific field(s)
          const aggregationField = this.buildAggregationField(
            queryDef.aggregation,
            queryDef.fields[0]
          );
          query = query.select(trx.raw(aggregationField));
        } else {
          // Process fields - wrap SQL expressions with raw()
          const selectFields = queryDef.fields.map(field => {
            if (this.isSqlExpression(field)) {
              this.assertSafeSqlExpression(field, 'report field expression');
              return trx.raw(field);
            }
            return field;
          });
          query = query.select(selectFields);
        }
      } else if (queryDef.aggregation) {
        // Handle aggregation queries without specific fields
        const aggregationField = this.buildAggregationField(queryDef.aggregation);
        query = query.select(trx.raw(aggregationField));
      } else {
        // Default to selecting all fields
        query = query.select('*');
      }
      
      // Add filters
      if (queryDef.filters && queryDef.filters.length > 0) {
        for (const filter of queryDef.filters) {
          query = this.applyFilter(query, filter, parameters);
        }
      }
      
      // Add group by
      if (queryDef.groupBy && queryDef.groupBy.length > 0) {
        query = query.groupBy(queryDef.groupBy);
      }
      
      // Add order by
      if (queryDef.orderBy && queryDef.orderBy.length > 0) {
        for (const order of queryDef.orderBy) {
          query = this.applyOrderBy(query, order);
        }
      }
      
      // Add limit
      if (queryDef.limit && queryDef.limit > 0) {
        query = query.limit(queryDef.limit);
      }
      
      return query;
      
    } catch (error) {
      throw new ReportExecutionError(
        `Failed to build query for table ${queryDef.table}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }
  
  /**
   * Apply a join to the query
   */
  private static buildRootQuery(
    trx: Knex.Transaction,
    queryDef: QueryDefinition,
    parameters: ReportParameters
  ): Knex.QueryBuilder {
    const tenant = this.reportTenant(parameters);

    if (!tenant) {
      return trx(queryDef.table);
    }

    return tenantDb(trx, tenant).table(queryDef.table);
  }

  private static applyJoin(
    trx: Knex.Transaction,
    query: Knex.QueryBuilder,
    join: JoinDefinition,
    parameters: ReportParameters
  ): Knex.QueryBuilder {
    const tenant = this.reportTenant(parameters);
    const nonTenantConditions = join.on.filter(condition => !this.isTenantEqualityJoinCondition(condition));

    if (tenant && nonTenantConditions.length > 0 && (join.type === 'inner' || join.type === 'left')) {
      const [primaryCondition, ...additionalConditions] = nonTenantConditions;
      const operator = primaryCondition.operator || '=';

      if (operator === '=') {
        return tenantDb(trx, tenant).tenantJoin(
          query,
          join.table,
          primaryCondition.left,
          primaryCondition.right,
          {
            type: join.type,
            on: (builder) => {
              for (const condition of additionalConditions) {
                builder.on(condition.left, condition.operator || '=', condition.right);
              }
            },
          }
        );
      }
    }

    const joinMethod = this.getJoinMethod(join.type);
    
    return (query as any)[joinMethod](join.table, (builder: any) => {
      for (const condition of join.on) {
        const operator = condition.operator || '=';
        builder.on(condition.left, operator, condition.right);
      }
    });
  }
  
  /**
   * Get the appropriate Knex join method for the join type
   */
  private static getJoinMethod(joinType: string): keyof Knex.QueryBuilder {
    switch (joinType) {
      case 'inner':
        return 'join';
      case 'left':
        return 'leftJoin';
      case 'right':
        return 'rightJoin';
      case 'full':
        return 'fullOuterJoin';
      default:
        return 'join';
    }
  }
  
  /**
   * Apply a filter to the query
   */
  private static applyFilter(
    query: Knex.QueryBuilder,
    filter: FilterDefinition,
    parameters: ReportParameters
  ): Knex.QueryBuilder {
    const value = this.resolveFilterValue(filter.value, parameters);
    const rawField = filter.field.startsWith('raw:') ? filter.field.slice(4) : null;

    if (rawField) {
      this.assertSafeSqlExpression(rawField, 'raw filter field');
    }

    if (this.isTenantScopeFilter(filter, value, parameters)) {
      return query;
    }

    // Skip filters with empty/null/undefined values (except for is_null/is_not_null operators)
    if (filter.operator !== 'is_null' && filter.operator !== 'is_not_null') {
      if (value === null || value === undefined || value === '') {
        return query; // Skip this filter
      }
      // Also skip empty arrays for in/not_in operators
      if (Array.isArray(value) && value.length === 0) {
        return query;
      }
    }

    switch (filter.operator) {
      case 'eq':
        return rawField ? query.whereRaw(`${rawField} = ?`, [value]) : query.where(filter.field, value);
      case 'neq':
        return rawField ? query.whereRaw(`${rawField} <> ?`, [value]) : query.whereNot(filter.field, value);
      case 'gt':
        return rawField ? query.whereRaw(`${rawField} > ?`, [value]) : query.where(filter.field, '>', value);
      case 'gte':
        return rawField ? query.whereRaw(`${rawField} >= ?`, [value]) : query.where(filter.field, '>=', value);
      case 'lt':
        return rawField ? query.whereRaw(`${rawField} < ?`, [value]) : query.where(filter.field, '<', value);
      case 'lte':
        return rawField ? query.whereRaw(`${rawField} <= ?`, [value]) : query.where(filter.field, '<=', value);
      case 'in':
        const inValues = Array.isArray(value) ? value : [value];
        if (rawField) {
          return query.whereRaw(
            `${rawField} in (${inValues.map(() => '?').join(', ')})`,
            inValues
          );
        }
        return query.whereIn(filter.field, inValues);
      case 'not_in':
        const notInValues = Array.isArray(value) ? value : [value];
        if (rawField) {
          return query.whereRaw(
            `${rawField} not in (${notInValues.map(() => '?').join(', ')})`,
            notInValues
          );
        }
        return query.whereNotIn(filter.field, notInValues);
      case 'like':
        return rawField ? query.whereRaw(`${rawField} like ?`, [value]) : query.where(filter.field, 'like', value);
      case 'is_null':
        return rawField ? query.whereRaw(`${rawField} is null`) : query.whereNull(filter.field);
      case 'is_not_null':
        return rawField ? query.whereRaw(`${rawField} is not null`) : query.whereNotNull(filter.field);
      default:
        throw new ReportExecutionError(
          `Unsupported filter operator: ${filter.operator}`
        );
    }
  }
  
  /**
   * Apply order by to the query
   */
  private static applyOrderBy(
    query: Knex.QueryBuilder,
    order: OrderDefinition
  ): Knex.QueryBuilder {
    return query.orderBy(order.field, order.direction || 'asc');
  }
  
  /**
   * Build aggregation field expression
   */
  private static buildAggregationField(aggregationType: string, field?: string): string {
    const targetField = field || '*';

    if (targetField !== '*') {
      this.assertSafeSqlExpression(targetField, 'aggregation field');
    }

    switch (aggregationType) {
      case 'count':
        return `COUNT(${targetField}) as count`;
      case 'count_distinct':
        return `COUNT(DISTINCT ${targetField}) as count_distinct`;
      case 'sum':
        return `SUM(${targetField}) as sum`;
      case 'avg':
        return `AVG(${targetField}) as avg`;
      case 'min':
        return `MIN(${targetField}) as min`;
      case 'max':
        return `MAX(${targetField}) as max`;
      default:
        throw new ReportExecutionError(`Unsupported aggregation type: ${aggregationType}`);
    }
  }

  /**
   * Build a parameterized raw SELECT query for internal report definitions.
   */
  private static buildParameterizedRawSql(
    trx: Knex.Transaction,
    rawSql: string,
    parameters: ReportParameters
  ): Knex.QueryBuilder {
    this.assertSafeRawSelect(rawSql);

    const bindings: unknown[] = [];
    const processedSql = rawSql.replace(/\{\{([^{}]+)\}\}/g, (_match, placeholder: string) => {
      if (placeholder !== placeholder.trim()) {
        throw new ReportExecutionError(`Raw SQL contains an invalid placeholder '${placeholder}'`);
      }

      if (placeholder.startsWith('tenant_table:')) {
        return this.buildTenantTableRawSql(
          trx,
          placeholder.slice('tenant_table:'.length),
          parameters,
          bindings
        );
      }

      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(placeholder)) {
        throw new ReportExecutionError(`Raw SQL contains an invalid placeholder '${placeholder}'`);
      }

      if (!(placeholder in parameters)) {
        throw new ReportExecutionError(`Parameter placeholder '${placeholder}' not found in parameters`);
      }

      bindings.push(parameters[placeholder]);
      return '?';
    });

    if (/\{\{|\}\}/.test(processedSql)) {
      throw new ReportExecutionError('Raw SQL contains an invalid or unresolved parameter placeholder');
    }

    return trx.raw(processedSql, bindings as Knex.RawBinding[]) as unknown as Knex.QueryBuilder;
  }

  private static buildTenantTableRawSql(
    trx: Knex.Transaction,
    tableExpression: string,
    parameters: ReportParameters,
    bindings: unknown[]
  ): string {
    const tenant = this.reportTenant(parameters);

    if (!tenant) {
      throw new ReportExecutionError('Raw SQL tenant table placeholder requires a tenant parameter');
    }

    this.assertSafeTenantTableExpression(tableExpression);

    const parsed = parseTableExpression(tableExpression);
    const scope = getTenantTableScope(parsed.tableName);

    if (!scope) {
      throw new ReportExecutionError(`No tenant table metadata registered for ${parsed.tableName}`);
    }

    if (scope.scope !== 'tenant') {
      throw new ReportExecutionError(`Raw SQL tenant table placeholder requires tenant table metadata for ${parsed.tableName}`);
    }

    const scopedTableSql = tenantDb(trx, tenant)
      .table(tableExpression)
      .select('*')
      .toSQL();

    bindings.push(...scopedTableSql.bindings);

    return `(${scopedTableSql.sql}) as ${this.quoteIdentifier(trx, parsed.rootAlias)}`;
  }

  /**
   * Raw report SQL is intentionally limited to single SELECT statements.
   */
  private static assertSafeRawSelect(rawSql: string): void {
    const trimmedSql = rawSql.trim();
    const lowerSql = trimmedSql.toLowerCase();

    if (!lowerSql.startsWith('select')) {
      throw new ReportExecutionError('Raw SQL mode only allows SELECT statements');
    }

    this.assertNoSqlControlTokens(trimmedSql, 'raw SQL report query');

    if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|execute|call|do|copy|merge|set)\b/i.test(trimmedSql)) {
      throw new ReportExecutionError('Raw SQL report query contains a forbidden statement keyword');
    }
  }

  /**
   * SQL expressions in report definitions are trusted internal config, but still
   * must be constrained to expression syntax to avoid future injection paths.
   */
  private static assertSafeSqlExpression(expression: string, context: string): void {
    const trimmedExpression = expression.trim();

    if (!trimmedExpression) {
      throw new ReportExecutionError(`${context} cannot be empty`);
    }

    this.assertNoSqlControlTokens(trimmedExpression, context);

    if (/\b(select|from|join|union|where|or|and|not|case|when|then|else|end|insert|update|delete|drop|alter|truncate|create|grant|revoke|execute|call|do|copy|merge|set|pg_sleep)\b|[=<>]/i.test(trimmedExpression)) {
      throw new ReportExecutionError(`${context} contains a forbidden SQL token`);
    }
  }

  private static assertNoSqlControlTokens(sql: string, context: string): void {
    if (/;|--|\/\*|\*\/|\$\$/u.test(sql)) {
      throw new ReportExecutionError(`${context} contains a forbidden SQL control token`);
    }
  }

  private static assertSafeTenantTableExpression(tableExpression: string): void {
    const trimmedExpression = tableExpression.trim();

    if (!trimmedExpression) {
      throw new ReportExecutionError('Raw SQL tenant table expression cannot be empty');
    }

    if (trimmedExpression !== tableExpression) {
      throw new ReportExecutionError('Raw SQL tenant table expression cannot have leading or trailing whitespace');
    }

    this.assertNoSqlControlTokens(trimmedExpression, 'raw SQL tenant table expression');

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?(?:\s+(?:as\s+)?[a-zA-Z_][a-zA-Z0-9_]*)?$/i.test(trimmedExpression)) {
      throw new ReportExecutionError(`Raw SQL tenant table expression '${trimmedExpression}' is invalid`);
    }

    if (/\b(select|from|join|where|union|on|using|insert|update|delete|drop|alter|truncate|create|grant|revoke|execute|call|do|copy|merge|set|with)\b/i.test(trimmedExpression)) {
      throw new ReportExecutionError(`Raw SQL tenant table expression '${trimmedExpression}' contains a forbidden SQL token`);
    }
  }

  private static quoteIdentifier(trx: Knex.Transaction, identifier: string): string {
    const quotedIdentifier = trx.raw('??', [identifier]).toSQL();

    if (quotedIdentifier.bindings.length > 0) {
      throw new ReportExecutionError(`Unable to quote SQL identifier '${identifier}'`);
    }

    return quotedIdentifier.sql;
  }
  /**
   * Resolve filter values, handling parameter placeholders
   */
  private static resolveFilterValue(value: any, parameters: ReportParameters): any {
    if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
      const paramName = value.slice(2, -2);

      if (!(paramName in parameters)) {
        throw new ReportExecutionError(
          `Parameter placeholder '${paramName}' not found in parameters`
        );
      }

      return parameters[paramName];
    }

    return value;
  }

  private static reportTenant(parameters: ReportParameters): string | null {
    const tenant = parameters.tenant;
    return typeof tenant === 'string' && tenant.trim() ? tenant : null;
  }

  private static isTenantScopeFilter(
    filter: FilterDefinition,
    resolvedValue: unknown,
    parameters: ReportParameters
  ): boolean {
    const tenant = this.reportTenant(parameters);
    return Boolean(
      tenant
        && filter.operator === 'eq'
        && resolvedValue === tenant
        && this.isTenantColumn(filter.field)
    );
  }

  private static isTenantEqualityJoinCondition(condition: { left: string; right: string; operator?: string }): boolean {
    return (condition.operator || '=') === '='
      && this.isTenantColumn(condition.left)
      && this.isTenantColumn(condition.right);
  }

  private static isTenantColumn(column: string): boolean {
    return column === 'tenant' || column.endsWith('.tenant');
  }

  /**
   * Check if a field string contains SQL expressions that need raw() wrapping.
   * Detects aggregate functions, arithmetic, and aliasing.
   */
  private static isSqlExpression(field: string): boolean {
    const lowerField = field.toLowerCase();

    // Contains SQL function calls (parentheses)
    if (field.includes('(') && field.includes(')')) {
      return true;
    }

    // Contains AS keyword for aliasing
    if (lowerField.includes(' as ')) {
      return true;
    }

    // Contains arithmetic operators
    if (/[+\-*/]/.test(field)) {
      return true;
    }

    // Contains common aggregate functions
    const aggregates = ['count', 'sum', 'avg', 'min', 'max', 'coalesce', 'distinct'];
    if (aggregates.some(agg => lowerField.includes(agg))) {
      return true;
    }

    return false;
  }

  /**
   * Validate query definition before building
   */
  static validateQueryDefinition(queryDef: QueryDefinition): void {
    if (!queryDef.table) {
      throw new ReportExecutionError('Query definition must specify a table');
    }
    
    // Validate joins
    if (queryDef.joins) {
      for (const join of queryDef.joins) {
        if (!join.table) {
          throw new ReportExecutionError('Join definition must specify a table');
        }
        if (!join.on || join.on.length === 0) {
          throw new ReportExecutionError('Join definition must specify join conditions');
        }
      }
    }
    
    // Validate filters
    if (queryDef.filters) {
      for (const filter of queryDef.filters) {
        if (!filter.field) {
          throw new ReportExecutionError('Filter definition must specify a field');
        }
        if (!filter.operator) {
          throw new ReportExecutionError('Filter definition must specify an operator');
        }
      }
    }
    
    // Validate order by
    if (queryDef.orderBy) {
      for (const order of queryDef.orderBy) {
        if (!order.field) {
          throw new ReportExecutionError('Order definition must specify a field');
        }
      }
    }
  }
}
