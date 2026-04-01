export type TemplateStrategyInput = Record<string, unknown>;

export type TemplateStrategyHandler = (input: TemplateStrategyInput) => unknown;

export class TemplateStrategyResolutionError extends Error {
  public readonly code: 'STRATEGY_NOT_ALLOWLISTED' = 'STRATEGY_NOT_ALLOWLISTED';
  public readonly strategyId: string;

  constructor(strategyId: string) {
    super(`Invoice template strategy "${strategyId}" is not allowlisted.`);
    this.name = 'TemplateStrategyResolutionError';
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

const allowlistedStrategies: Readonly<Record<string, TemplateStrategyHandler>> = {
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

export const listAllowlistedTemplateStrategyIds = (): string[] =>
  Object.keys(allowlistedStrategies);

export const isAllowlistedTemplateStrategy = (strategyId: string): boolean =>
  Object.prototype.hasOwnProperty.call(allowlistedStrategies, strategyId);

export const resolveTemplateStrategy = (strategyId: string): TemplateStrategyHandler => {
  const strategy = allowlistedStrategies[strategyId];
  if (!strategy) {
    throw new TemplateStrategyResolutionError(strategyId);
  }
  return strategy;
};

export const executeTemplateStrategy = (
  strategyId: string,
  input: TemplateStrategyInput
): unknown => resolveTemplateStrategy(strategyId)(input);
