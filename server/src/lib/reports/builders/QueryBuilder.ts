// QueryBuilder utility for constructing database queries from report definitions

import { Knex } from 'knex';
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
      // Handle raw SQL mode - when table is 'raw_sql', the SQL is in fields[0]
      if (queryDef.table === 'raw_sql') {
        const rawSql = queryDef.fields?.[0];
        if (!rawSql || typeof rawSql !== 'string') {
          throw new ReportExecutionError('Raw SQL mode requires SQL query in fields[0]');
        }

        // Basic security check - only allow SELECT statements
        const trimmedSql = rawSql.trim().toLowerCase();
        if (!trimmedSql.startsWith('select')) {
          throw new ReportExecutionError('Raw SQL mode only allows SELECT statements');
        }

        // Substitute parameters in the SQL
        let processedSql = rawSql;
        for (const [key, value] of Object.entries(parameters)) {
          const placeholder = `{{${key}}}`;
          if (processedSql.includes(placeholder)) {
            // Escape the value to prevent SQL injection
            const escapedValue = typeof value === 'string'
              ? `'${value.replace(/'/g, "''")}'`
              : String(value);
            processedSql = processedSql.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), escapedValue);
          }
        }

        return trx.raw(processedSql) as unknown as Knex.QueryBuilder;
      }

      let query = trx(queryDef.table);
      
      // Add joins
      if (queryDef.joins && queryDef.joins.length > 0) {
        for (const join of queryDef.joins) {
          query = this.applyJoin(query, join);
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
  private static applyJoin(
    query: Knex.QueryBuilder,
    join: JoinDefinition
  ): Knex.QueryBuilder {
    
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
    
    switch (filter.operator) {
      case 'eq':
        return query.where(filter.field, value);
      case 'neq':
        return query.whereNot(filter.field, value);
      case 'gt':
        return query.where(filter.field, '>', value);
      case 'gte':
        return query.where(filter.field, '>=', value);
      case 'lt':
        return query.where(filter.field, '<', value);
      case 'lte':
        return query.where(filter.field, '<=', value);
      case 'in':
        const inValues = Array.isArray(value) ? value : [value];
        return query.whereIn(filter.field, inValues);
      case 'not_in':
        const notInValues = Array.isArray(value) ? value : [value];
        return query.whereNotIn(filter.field, notInValues);
      case 'like':
        return query.where(filter.field, 'like', value);
      case 'is_null':
        return query.whereNull(filter.field);
      case 'is_not_null':
        return query.whereNotNull(filter.field);
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
        return `${aggregationType.toUpperCase()}(${targetField}) as ${aggregationType}`;
    }
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