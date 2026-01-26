/**
 * Custom Field Report Helpers
 *
 * Utilities for including custom fields in reports, filtering by custom field values,
 * and grouping data by custom fields.
 */

import { Knex } from 'knex';
import {
  ICustomField,
  CustomFieldEntityType,
  CustomFieldType
} from 'server/src/interfaces/customField.interfaces';
import { FilterOperator, FilterDefinition } from '../core/types';

/**
 * Maps entity types to their respective tables and value storage locations
 */
const ENTITY_CONFIG: Record<CustomFieldEntityType, {
  table: string;
  idColumn: string;
  valueTable: string;
}> = {
  ticket: {
    table: 'tickets',
    idColumn: 'ticket_id',
    valueTable: 'custom_field_values'
  },
  company: {
    table: 'companies',
    idColumn: 'company_id',
    valueTable: 'custom_field_values'
  },
  contact: {
    table: 'contacts',
    idColumn: 'contact_name_id',
    valueTable: 'custom_field_values'
  }
};

/**
 * Custom field filter definition for reports
 */
export interface CustomFieldFilterDefinition {
  fieldId: string;
  fieldName: string;
  fieldType: CustomFieldType;
  operator: CustomFieldFilterOperator;
  value: any;
}

/**
 * Extended filter operators for custom fields
 */
export type CustomFieldFilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'greater_than_or_equal'
  | 'less_than_or_equal'
  | 'is_empty'
  | 'is_not_empty'
  | 'in'
  | 'not_in'
  | 'between';

/**
 * Custom field column definition for report results
 */
export interface CustomFieldColumnDefinition {
  fieldId: string;
  fieldName: string;
  fieldType: CustomFieldType;
  alias?: string;
}

/**
 * Build a SQL expression to extract a custom field value from JSONB
 *
 * @param fieldId - The custom field ID
 * @param fieldType - The type of the custom field
 * @param alias - Optional alias for the result column
 * @returns SQL expression string
 */
export function buildCustomFieldExtractExpression(
  fieldId: string,
  fieldType: CustomFieldType,
  alias?: string
): string {
  const columnAlias = alias || `cf_${fieldId.replace(/-/g, '_')}`;

  // Use appropriate casting based on field type
  switch (fieldType) {
    case 'number':
      return `(cfv.value->>'${fieldId}')::numeric AS ${columnAlias}`;
    case 'boolean':
      return `(cfv.value->>'${fieldId}')::boolean AS ${columnAlias}`;
    case 'date':
      return `(cfv.value->>'${fieldId}')::timestamp AS ${columnAlias}`;
    case 'multi_picklist':
      // Return as JSONB array for multi-select fields
      return `cfv.value->'${fieldId}' AS ${columnAlias}`;
    case 'text':
    case 'picklist':
    default:
      return `cfv.value->>'${fieldId}' AS ${columnAlias}`;
  }
}

/**
 * Build a join to the custom_field_values table
 *
 * @param entityType - The entity type (ticket, company, contact)
 * @param entityAlias - Optional alias for the entity table
 * @returns Join definition object
 */
export function buildCustomFieldJoin(
  entityType: CustomFieldEntityType,
  entityAlias?: string
): {
  table: string;
  on: { left: string; right: string }[];
} {
  const config = ENTITY_CONFIG[entityType];
  const tableAlias = entityAlias || config.table;

  return {
    table: 'custom_field_values as cfv',
    on: [
      {
        left: `${tableAlias}.${config.idColumn}`,
        right: 'cfv.entity_id'
      }
    ]
  };
}

/**
 * Build a WHERE clause for filtering by custom field value
 *
 * @param trx - Knex transaction
 * @param query - Knex query builder
 * @param filter - Custom field filter definition
 * @returns Modified query builder
 */
export function applyCustomFieldFilter(
  trx: Knex.Transaction,
  query: Knex.QueryBuilder,
  filter: CustomFieldFilterDefinition
): Knex.QueryBuilder {
  const { fieldId, fieldType, operator, value } = filter;

  // Build the JSONB path expression
  const jsonPath = `cfv.value->>'${fieldId}'`;

  switch (operator) {
    case 'equals':
      if (fieldType === 'multi_picklist' && Array.isArray(value)) {
        // For multi-picklist, check if the array contains all specified values
        return query.whereRaw(`cfv.value->'${fieldId}' @> ?::jsonb`, [JSON.stringify(value)]);
      }
      return query.whereRaw(`${jsonPath} = ?`, [String(value)]);

    case 'not_equals':
      return query.whereRaw(`${jsonPath} != ?`, [String(value)]);

    case 'contains':
      if (fieldType === 'multi_picklist') {
        // Check if array contains the value
        return query.whereRaw(`cfv.value->'${fieldId}' @> ?::jsonb`, [JSON.stringify([value])]);
      }
      return query.whereRaw(`${jsonPath} ILIKE ?`, [`%${value}%`]);

    case 'not_contains':
      if (fieldType === 'multi_picklist') {
        return query.whereRaw(`NOT (cfv.value->'${fieldId}' @> ?::jsonb)`, [JSON.stringify([value])]);
      }
      return query.whereRaw(`${jsonPath} NOT ILIKE ?`, [`%${value}%`]);

    case 'starts_with':
      return query.whereRaw(`${jsonPath} ILIKE ?`, [`${value}%`]);

    case 'ends_with':
      return query.whereRaw(`${jsonPath} ILIKE ?`, [`%${value}`]);

    case 'greater_than':
      if (fieldType === 'number') {
        return query.whereRaw(`(${jsonPath})::numeric > ?`, [value]);
      }
      if (fieldType === 'date') {
        return query.whereRaw(`(${jsonPath})::timestamp > ?`, [value]);
      }
      return query.whereRaw(`${jsonPath} > ?`, [String(value)]);

    case 'less_than':
      if (fieldType === 'number') {
        return query.whereRaw(`(${jsonPath})::numeric < ?`, [value]);
      }
      if (fieldType === 'date') {
        return query.whereRaw(`(${jsonPath})::timestamp < ?`, [value]);
      }
      return query.whereRaw(`${jsonPath} < ?`, [String(value)]);

    case 'greater_than_or_equal':
      if (fieldType === 'number') {
        return query.whereRaw(`(${jsonPath})::numeric >= ?`, [value]);
      }
      if (fieldType === 'date') {
        return query.whereRaw(`(${jsonPath})::timestamp >= ?`, [value]);
      }
      return query.whereRaw(`${jsonPath} >= ?`, [String(value)]);

    case 'less_than_or_equal':
      if (fieldType === 'number') {
        return query.whereRaw(`(${jsonPath})::numeric <= ?`, [value]);
      }
      if (fieldType === 'date') {
        return query.whereRaw(`(${jsonPath})::timestamp <= ?`, [value]);
      }
      return query.whereRaw(`${jsonPath} <= ?`, [String(value)]);

    case 'is_empty':
      return query.whereRaw(`(${jsonPath} IS NULL OR ${jsonPath} = '')`);

    case 'is_not_empty':
      return query.whereRaw(`(${jsonPath} IS NOT NULL AND ${jsonPath} != '')`);

    case 'in':
      const inValues = Array.isArray(value) ? value : [value];
      return query.whereRaw(`${jsonPath} IN (${inValues.map(() => '?').join(',')})`, inValues.map(String));

    case 'not_in':
      const notInValues = Array.isArray(value) ? value : [value];
      return query.whereRaw(`${jsonPath} NOT IN (${notInValues.map(() => '?').join(',')})`, notInValues.map(String));

    case 'between':
      if (!Array.isArray(value) || value.length !== 2) {
        throw new Error('Between operator requires an array of two values');
      }
      if (fieldType === 'number') {
        return query.whereRaw(`(${jsonPath})::numeric BETWEEN ? AND ?`, value);
      }
      if (fieldType === 'date') {
        return query.whereRaw(`(${jsonPath})::timestamp BETWEEN ? AND ?`, value);
      }
      return query.whereRaw(`${jsonPath} BETWEEN ? AND ?`, value.map(String));

    default:
      throw new Error(`Unsupported custom field filter operator: ${operator}`);
  }
}

/**
 * Build a GROUP BY expression for a custom field
 *
 * @param fieldId - The custom field ID
 * @param fieldType - The type of the custom field
 * @returns SQL expression for GROUP BY
 */
export function buildCustomFieldGroupBy(
  fieldId: string,
  fieldType: CustomFieldType
): string {
  // For grouping, we just need the raw value extraction
  return `cfv.value->>'${fieldId}'`;
}

/**
 * Build aggregation expressions for custom field values
 *
 * @param fieldId - The custom field ID
 * @param fieldType - The type of the custom field
 * @param aggregation - The type of aggregation
 * @param alias - Optional alias for the result
 * @returns SQL expression for aggregation
 */
export function buildCustomFieldAggregation(
  fieldId: string,
  fieldType: CustomFieldType,
  aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'count_distinct',
  alias?: string
): string {
  const jsonPath = `cfv.value->>'${fieldId}'`;
  const columnAlias = alias || `cf_${aggregation}_${fieldId.replace(/-/g, '_')}`;

  switch (aggregation) {
    case 'count':
      return `COUNT(${jsonPath}) AS ${columnAlias}`;

    case 'count_distinct':
      return `COUNT(DISTINCT ${jsonPath}) AS ${columnAlias}`;

    case 'sum':
      if (fieldType !== 'number') {
        throw new Error('SUM aggregation only supported for number fields');
      }
      return `SUM((${jsonPath})::numeric) AS ${columnAlias}`;

    case 'avg':
      if (fieldType !== 'number') {
        throw new Error('AVG aggregation only supported for number fields');
      }
      return `AVG((${jsonPath})::numeric) AS ${columnAlias}`;

    case 'min':
      if (fieldType === 'number') {
        return `MIN((${jsonPath})::numeric) AS ${columnAlias}`;
      }
      if (fieldType === 'date') {
        return `MIN((${jsonPath})::timestamp) AS ${columnAlias}`;
      }
      return `MIN(${jsonPath}) AS ${columnAlias}`;

    case 'max':
      if (fieldType === 'number') {
        return `MAX((${jsonPath})::numeric) AS ${columnAlias}`;
      }
      if (fieldType === 'date') {
        return `MAX((${jsonPath})::timestamp) AS ${columnAlias}`;
      }
      return `MAX(${jsonPath}) AS ${columnAlias}`;

    default:
      throw new Error(`Unsupported aggregation type: ${aggregation}`);
  }
}

/**
 * Convert standard FilterOperator to CustomFieldFilterOperator
 */
export function convertToCustomFieldOperator(operator: FilterOperator): CustomFieldFilterOperator {
  const operatorMap: Record<FilterOperator, CustomFieldFilterOperator> = {
    'eq': 'equals',
    'neq': 'not_equals',
    'gt': 'greater_than',
    'gte': 'greater_than_or_equal',
    'lt': 'less_than',
    'lte': 'less_than_or_equal',
    'in': 'in',
    'not_in': 'not_in',
    'like': 'contains',
    'is_null': 'is_empty',
    'is_not_null': 'is_not_empty'
  };

  return operatorMap[operator] || 'equals';
}

/**
 * Format a custom field value for display in reports
 *
 * @param value - The raw value
 * @param fieldType - The type of the custom field
 * @param options - The field options (for picklist types)
 * @returns Formatted display value
 */
export function formatCustomFieldValue(
  value: any,
  fieldType: CustomFieldType,
  options?: Array<{ value: string; label: string }>
): string {
  if (value === null || value === undefined) {
    return '';
  }

  switch (fieldType) {
    case 'boolean':
      return value === true || value === 'true' ? 'Yes' : 'No';

    case 'date':
      if (value instanceof Date) {
        return value.toLocaleDateString();
      }
      return new Date(value).toLocaleDateString();

    case 'number':
      return typeof value === 'number' ? value.toLocaleString() : String(value);

    case 'picklist':
      if (options) {
        const option = options.find(o => o.value === value);
        return option ? option.label : String(value);
      }
      return String(value);

    case 'multi_picklist':
      const values = Array.isArray(value) ? value : [];
      if (options) {
        return values
          .map(v => {
            const option = options.find(o => o.value === v);
            return option ? option.label : v;
          })
          .join(', ');
      }
      return values.join(', ');

    case 'text':
    default:
      return String(value);
  }
}

/**
 * Build select expressions for multiple custom fields
 *
 * @param columns - Array of custom field column definitions
 * @returns Array of SQL select expressions
 */
export function buildCustomFieldSelects(
  columns: CustomFieldColumnDefinition[]
): string[] {
  return columns.map(col =>
    buildCustomFieldExtractExpression(col.fieldId, col.fieldType, col.alias)
  );
}

/**
 * Apply multiple custom field filters to a query
 *
 * @param trx - Knex transaction
 * @param query - Knex query builder
 * @param filters - Array of custom field filter definitions
 * @returns Modified query builder
 */
export function applyCustomFieldFilters(
  trx: Knex.Transaction,
  query: Knex.QueryBuilder,
  filters: CustomFieldFilterDefinition[]
): Knex.QueryBuilder {
  let result = query;

  for (const filter of filters) {
    result = applyCustomFieldFilter(trx, result, filter);
  }

  return result;
}

/**
 * Get the available filter operators for a custom field type
 *
 * @param fieldType - The type of the custom field
 * @returns Array of available operators
 */
export function getAvailableOperatorsForFieldType(
  fieldType: CustomFieldType
): CustomFieldFilterOperator[] {
  const commonOperators: CustomFieldFilterOperator[] = [
    'equals',
    'not_equals',
    'is_empty',
    'is_not_empty'
  ];

  switch (fieldType) {
    case 'text':
      return [
        ...commonOperators,
        'contains',
        'not_contains',
        'starts_with',
        'ends_with',
        'in',
        'not_in'
      ];

    case 'number':
      return [
        ...commonOperators,
        'greater_than',
        'less_than',
        'greater_than_or_equal',
        'less_than_or_equal',
        'between',
        'in',
        'not_in'
      ];

    case 'date':
      return [
        ...commonOperators,
        'greater_than',
        'less_than',
        'greater_than_or_equal',
        'less_than_or_equal',
        'between'
      ];

    case 'boolean':
      return ['equals', 'not_equals'];

    case 'picklist':
      return [
        ...commonOperators,
        'in',
        'not_in'
      ];

    case 'multi_picklist':
      return [
        'contains',
        'not_contains',
        'is_empty',
        'is_not_empty'
      ];

    default:
      return commonOperators;
  }
}

/**
 * Get the display label for a filter operator
 */
export function getOperatorLabel(operator: CustomFieldFilterOperator): string {
  const labels: Record<CustomFieldFilterOperator, string> = {
    'equals': 'Equals',
    'not_equals': 'Does not equal',
    'contains': 'Contains',
    'not_contains': 'Does not contain',
    'starts_with': 'Starts with',
    'ends_with': 'Ends with',
    'greater_than': 'Greater than',
    'less_than': 'Less than',
    'greater_than_or_equal': 'Greater than or equal',
    'less_than_or_equal': 'Less than or equal',
    'is_empty': 'Is empty',
    'is_not_empty': 'Is not empty',
    'in': 'Is one of',
    'not_in': 'Is not one of',
    'between': 'Between'
  };

  return labels[operator] || operator;
}
