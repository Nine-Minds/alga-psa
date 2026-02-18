export type InvoiceTemplateStrategyInput = Record<string, unknown>;

export type InvoiceTemplateStrategyHandler = (input: InvoiceTemplateStrategyInput) => unknown;

export class InvoiceTemplateStrategyResolutionError extends Error {
  public readonly code: 'STRATEGY_NOT_ALLOWLISTED' = 'STRATEGY_NOT_ALLOWLISTED';
  public readonly strategyId: string;

  constructor(strategyId: string) {
    super(`Invoice template strategy "${strategyId}" is not allowlisted.`);
    this.name = 'InvoiceTemplateStrategyResolutionError';
    this.strategyId = strategyId;
  }
}

const toSafeNumeric = (value: unknown): number => {
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

const allowlistedStrategies: Readonly<Record<string, InvoiceTemplateStrategyHandler>> = {
  'custom-group-key': (input) => {
    const item = (input.item ?? null) as Record<string, unknown> | null;
    const rawValue = item?.category ?? item?.group ?? item?.type ?? 'ungrouped';
    return String(rawValue).trim().toLowerCase() || 'ungrouped';
  },
  'custom-aggregate': (input) => {
    const items = Array.isArray(input.items) ? input.items : [];
    const path = typeof input.path === 'string' && input.path.length > 0 ? input.path : 'total';

    return items.reduce((sum, item) => {
      if (!item || typeof item !== 'object') {
        return sum;
      }
      const value = (item as Record<string, unknown>)[path];
      return sum + toSafeNumeric(value);
    }, 0);
  },
};

export const listAllowlistedInvoiceTemplateStrategyIds = (): string[] =>
  Object.keys(allowlistedStrategies);

export const isAllowlistedInvoiceTemplateStrategy = (strategyId: string): boolean =>
  Object.prototype.hasOwnProperty.call(allowlistedStrategies, strategyId);

export const resolveInvoiceTemplateStrategy = (strategyId: string): InvoiceTemplateStrategyHandler => {
  const strategy = allowlistedStrategies[strategyId];
  if (!strategy) {
    throw new InvoiceTemplateStrategyResolutionError(strategyId);
  }
  return strategy;
};

export const executeInvoiceTemplateStrategy = (
  strategyId: string,
  input: InvoiceTemplateStrategyInput
): unknown => resolveInvoiceTemplateStrategy(strategyId)(input);
