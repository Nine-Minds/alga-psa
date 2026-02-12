import type {
  InvoiceTemplateAggregateTransform,
  InvoiceTemplateAst,
  InvoiceTemplateComputationExpression,
  InvoiceTemplateFilterTransform,
  InvoiceTemplateGroupTransform,
  InvoiceTemplatePredicate,
  InvoiceTemplateSortTransform,
} from '@alga-psa/types';
import {
  executeInvoiceTemplateStrategy,
  isAllowlistedInvoiceTemplateStrategy,
  resolveInvoiceTemplateStrategy,
} from './strategies';

type UnknownRecord = Record<string, unknown>;

export interface InvoiceTemplateEvaluatedGroup {
  key: string;
  items: UnknownRecord[];
  aggregates?: Record<string, number>;
}

export interface InvoiceTemplateEvaluationResult {
  sourceCollection: UnknownRecord[];
  output: UnknownRecord[] | InvoiceTemplateEvaluatedGroup[];
  groups: InvoiceTemplateEvaluatedGroup[] | null;
  aggregates: Record<string, number>;
  totals: Record<string, number>;
  bindings: Record<string, unknown>;
}

export class InvoiceTemplateEvaluationError extends Error {
  public readonly code:
    | 'INVALID_SOURCE_COLLECTION'
    | 'MISSING_BINDING'
    | 'INVALID_TRANSFORM_INPUT'
    | 'UNKNOWN_STRATEGY'
    | 'STRATEGY_EXECUTION_FAILED';
  public readonly operationId?: string;

  constructor(
    code: InvoiceTemplateEvaluationError['code'],
    message: string,
    operationId?: string
  ) {
    super(message);
    this.name = 'InvoiceTemplateEvaluationError';
    this.code = code;
    this.operationId = operationId;
  }
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const cloneRecordArray = (value: unknown): UnknownRecord[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => (isRecord(item) ? { ...item } : {}));
};

const getPathValue = (target: unknown, path: string): unknown => {
  if (!path || path.trim().length === 0) {
    return target;
  }

  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      return current[Number(segment)];
    }

    if (typeof current === 'object') {
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, target);
};

const safeNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
};

const compareValues = (left: unknown, right: unknown): number => {
  if (left === right) {
    return 0;
  }

  if (left === null || left === undefined) {
    return -1;
  }
  if (right === null || right === undefined) {
    return 1;
  }

  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  return String(left).localeCompare(String(right));
};

const resolveBindingValue = (
  ast: InvoiceTemplateAst,
  bindingId: string,
  invoiceData: UnknownRecord
): unknown => {
  const valueBinding = ast.bindings?.values?.[bindingId];
  if (valueBinding) {
    const resolved = getPathValue(invoiceData, valueBinding.path);
    return resolved === undefined ? valueBinding.fallback : resolved;
  }

  const collectionBinding = ast.bindings?.collections?.[bindingId];
  if (collectionBinding) {
    return getPathValue(invoiceData, collectionBinding.path);
  }

  return getPathValue(invoiceData, bindingId);
};

const evaluatePredicate = (predicate: InvoiceTemplatePredicate, item: UnknownRecord): boolean => {
  if (predicate.type === 'comparison') {
    const left = getPathValue(item, predicate.path);
    const right = predicate.value;

    switch (predicate.op) {
      case 'eq':
        return left === right;
      case 'neq':
        return left !== right;
      case 'gt':
        return safeNumber(left) > safeNumber(right);
      case 'gte':
        return safeNumber(left) >= safeNumber(right);
      case 'lt':
        return safeNumber(left) < safeNumber(right);
      case 'lte':
        return safeNumber(left) <= safeNumber(right);
      case 'in':
        return Array.isArray(right) ? right.includes(left as never) : false;
      default:
        return false;
    }
  }

  if (predicate.type === 'logical') {
    return predicate.op === 'and'
      ? predicate.conditions.every((condition) => evaluatePredicate(condition, item))
      : predicate.conditions.some((condition) => evaluatePredicate(condition, item));
  }

  return !evaluatePredicate(predicate.condition, item);
};

const applyFilterTransform = (
  items: UnknownRecord[],
  operation: InvoiceTemplateFilterTransform
): UnknownRecord[] => items.filter((item) => evaluatePredicate(operation.predicate, item));

const applySortTransform = (
  items: UnknownRecord[],
  operation: InvoiceTemplateSortTransform
): UnknownRecord[] => {
  const indexed = items.map((item, index) => ({ item, index }));
  indexed.sort((leftEntry, rightEntry) => {
    for (const key of operation.keys) {
      const left = getPathValue(leftEntry.item, key.path);
      const right = getPathValue(rightEntry.item, key.path);
      const leftMissing = left === null || left === undefined;
      const rightMissing = right === null || right === undefined;

      if (leftMissing || rightMissing) {
        if (leftMissing && rightMissing) {
          continue;
        }
        const nullOrder = key.nulls ?? 'last';
        const missingWins = nullOrder === 'first' ? -1 : 1;
        return leftMissing ? missingWins : -missingWins;
      }

      const compared = compareValues(left, right);
      if (compared !== 0) {
        return key.direction === 'desc' ? -compared : compared;
      }
    }
    return leftEntry.index - rightEntry.index;
  });
  return indexed.map(({ item }) => item);
};

const applyGroupTransform = (
  items: UnknownRecord[],
  operation: InvoiceTemplateGroupTransform
): InvoiceTemplateEvaluatedGroup[] => {
  const groups = new Map<string, UnknownRecord[]>();

  for (const item of items) {
    let groupKey: string;
    if (operation.strategyId) {
      if (!isAllowlistedInvoiceTemplateStrategy(operation.strategyId)) {
        throw new InvoiceTemplateEvaluationError(
          'UNKNOWN_STRATEGY',
          `Unknown strategy "${operation.strategyId}" for group operation "${operation.id}".`,
          operation.id
        );
      }
      try {
        const value = executeInvoiceTemplateStrategy(operation.strategyId, { item, items, keyPath: operation.key });
        groupKey = String(value ?? 'ungrouped');
      } catch (error) {
        throw new InvoiceTemplateEvaluationError(
          'STRATEGY_EXECUTION_FAILED',
          `Strategy "${operation.strategyId}" failed for group operation "${operation.id}": ${
            error instanceof Error ? error.message : String(error)
          }`,
          operation.id
        );
      }
    } else {
      const value = getPathValue(item, operation.key);
      groupKey = String(value ?? 'ungrouped');
    }

    const existing = groups.get(groupKey);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(groupKey, [item]);
    }
  }

  return [...groups.entries()].map(([key, groupedItems]) => ({
    key,
    items: groupedItems,
  }));
};

const computeAggregateFromItems = (
  items: UnknownRecord[],
  operation: InvoiceTemplateAggregateTransform
): Record<string, number> => {
  const result: Record<string, number> = {};

  for (const aggregation of operation.aggregations) {
    if (operation.strategyId) {
      if (!isAllowlistedInvoiceTemplateStrategy(operation.strategyId)) {
        throw new InvoiceTemplateEvaluationError(
          'UNKNOWN_STRATEGY',
          `Unknown strategy "${operation.strategyId}" for aggregate operation "${operation.id}".`,
          operation.id
        );
      }
      try {
        const value = executeInvoiceTemplateStrategy(operation.strategyId, {
          items,
          path: aggregation.path,
          aggregateOp: aggregation.op,
        });
        result[aggregation.id] = safeNumber(value);
      } catch (error) {
        throw new InvoiceTemplateEvaluationError(
          'STRATEGY_EXECUTION_FAILED',
          `Strategy "${operation.strategyId}" failed for aggregate operation "${operation.id}": ${
            error instanceof Error ? error.message : String(error)
          }`,
          operation.id
        );
      }
      continue;
    }

    const values = aggregation.path
      ? items.map((item) => safeNumber(getPathValue(item, aggregation.path as string)))
      : items.map(() => 1);

    switch (aggregation.op) {
      case 'count':
        result[aggregation.id] = items.length;
        break;
      case 'sum':
        result[aggregation.id] = values.reduce((sum, value) => sum + value, 0);
        break;
      case 'avg':
        result[aggregation.id] =
          values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
        break;
      case 'min':
        result[aggregation.id] = values.length > 0 ? Math.min(...values) : 0;
        break;
      case 'max':
        result[aggregation.id] = values.length > 0 ? Math.max(...values) : 0;
        break;
      default:
        result[aggregation.id] = 0;
    }
  }

  return result;
};

const evaluateComputationExpression = (
  expression: InvoiceTemplateComputationExpression,
  context: {
    invoiceData: UnknownRecord;
    item?: UnknownRecord;
    aggregates: Record<string, number>;
  }
): number => {
  switch (expression.type) {
    case 'literal':
      return safeNumber(expression.value);
    case 'path': {
      const source = context.item ?? context.invoiceData;
      return safeNumber(getPathValue(source, expression.path));
    }
    case 'aggregate-ref':
      return safeNumber(context.aggregates[expression.aggregateId]);
    case 'binary': {
      const left = evaluateComputationExpression(expression.left, context);
      const right = evaluateComputationExpression(expression.right, context);
      switch (expression.op) {
        case 'add':
          return left + right;
        case 'subtract':
          return left - right;
        case 'multiply':
          return left * right;
        case 'divide':
          return right === 0 ? 0 : left / right;
        default:
          return 0;
      }
    }
    default:
      return 0;
  }
};

const flattenGroups = (groups: InvoiceTemplateEvaluatedGroup[]): UnknownRecord[] =>
  groups.flatMap((group) => group.items);

export const evaluateInvoiceTemplateAst = (
  ast: InvoiceTemplateAst,
  invoiceDataInput: UnknownRecord
): InvoiceTemplateEvaluationResult => {
  const invoiceData = isRecord(invoiceDataInput) ? invoiceDataInput : {};
  const bindings: Record<string, unknown> = {
    invoice: invoiceData,
  };

  for (const [bindingId, binding] of Object.entries(ast.bindings?.values ?? {})) {
    const resolved = getPathValue(invoiceData, binding.path);
    bindings[bindingId] = resolved === undefined ? binding.fallback : resolved;
  }
  for (const [bindingId, binding] of Object.entries(ast.bindings?.collections ?? {})) {
    bindings[bindingId] = cloneRecordArray(getPathValue(invoiceData, binding.path));
  }

  if (!ast.transforms) {
    return {
      sourceCollection: [],
      output: [],
      groups: null,
      aggregates: {},
      totals: {},
      bindings,
    };
  }

  const sourceValue = resolveBindingValue(ast, ast.transforms.sourceBindingId, invoiceData);
  if (!Array.isArray(sourceValue)) {
    throw new InvoiceTemplateEvaluationError(
      'INVALID_SOURCE_COLLECTION',
      `Transform source binding "${ast.transforms.sourceBindingId}" must resolve to an array.`
    );
  }

  const sourceCollection = cloneRecordArray(sourceValue);
  let currentItems = sourceCollection;
  let groups: InvoiceTemplateEvaluatedGroup[] | null = null;
  let aggregates: Record<string, number> = {};
  let totals: Record<string, number> = {};

  for (const operation of ast.transforms.operations) {
    switch (operation.type) {
      case 'filter':
        currentItems = applyFilterTransform(currentItems, operation);
        groups = null;
        break;
      case 'sort':
        currentItems = applySortTransform(currentItems, operation);
        groups = null;
        break;
      case 'computed-field': {
        currentItems = currentItems.map((item) => {
          const next = { ...item };
          for (const field of operation.fields) {
            next[field.id] = evaluateComputationExpression(field.expression, {
              invoiceData,
              item: next,
              aggregates,
            });
          }
          return next;
        });
        groups = null;
        break;
      }
      case 'group':
        groups = applyGroupTransform(currentItems, operation);
        break;
      case 'aggregate': {
        const aggregateSource = groups ? flattenGroups(groups) : currentItems;
        if (!Array.isArray(aggregateSource)) {
          throw new InvoiceTemplateEvaluationError(
            'INVALID_TRANSFORM_INPUT',
            `Aggregate operation "${operation.id}" requires array input.`,
            operation.id
          );
        }
        aggregates = computeAggregateFromItems(aggregateSource, operation);
        if (groups) {
          groups = groups.map((group) => ({
            ...group,
            aggregates: computeAggregateFromItems(group.items, operation),
          }));
        }
        break;
      }
      case 'totals-compose': {
        totals = {};
        for (const total of operation.totals) {
          if (operation.strategyId) {
            if (!isAllowlistedInvoiceTemplateStrategy(operation.strategyId)) {
              throw new InvoiceTemplateEvaluationError(
                'UNKNOWN_STRATEGY',
                `Unknown strategy "${operation.strategyId}" for totals operation "${operation.id}".`,
                operation.id
              );
            }
            try {
              const strategy = resolveInvoiceTemplateStrategy(operation.strategyId);
              totals[total.id] = safeNumber(
                strategy({
                  totalId: total.id,
                  totals,
                  aggregates,
                  invoice: invoiceData,
                  expression: total.value,
                })
              );
            } catch (error) {
              throw new InvoiceTemplateEvaluationError(
                'STRATEGY_EXECUTION_FAILED',
                `Strategy "${operation.strategyId}" failed for totals operation "${operation.id}": ${
                  error instanceof Error ? error.message : String(error)
                }`,
                operation.id
              );
            }
          } else {
            totals[total.id] = evaluateComputationExpression(total.value, {
              invoiceData,
              aggregates,
            });
          }
        }
        break;
      }
      default:
        break;
    }
  }

  const output = groups ?? currentItems;
  bindings[ast.transforms.outputBindingId] = output;
  bindings[`${ast.transforms.outputBindingId}.aggregates`] = aggregates;
  bindings[`${ast.transforms.outputBindingId}.totals`] = totals;

  return {
    sourceCollection,
    output,
    groups,
    aggregates,
    totals,
    bindings,
  };
};

export const evaluateAstTransforms = (
  ast: InvoiceTemplateAst,
  invoiceData: UnknownRecord
): InvoiceTemplateEvaluationResult => evaluateInvoiceTemplateAst(ast, invoiceData);
