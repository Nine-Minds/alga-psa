import { getWorkflowEventCorrelationPaths } from '@alga-psa/shared/workflow/runtime';

export type WorkflowEventCorrelationResolution = {
  /** Primary key (first derivable value); persisted on the event row. */
  key: string | null;
  /** Every derivable key, priority-ordered and deduped. Wait routing must consider all of them. */
  keys: string[];
  source: 'explicit' | 'derived' | 'missing';
  detail: string;
};

type ResolveWorkflowEventCorrelationInput = {
  eventName: string;
  payload: Record<string, unknown>;
  explicitCorrelationKey?: string | null;
};

export function resolveWorkflowEventCorrelation(
  input: ResolveWorkflowEventCorrelationInput
): WorkflowEventCorrelationResolution {
  const explicit = resolveExplicitCorrelation(input.explicitCorrelationKey);
  if (explicit) {
    return {
      key: explicit,
      keys: [explicit],
      source: 'explicit',
      detail: 'event.workflow_correlation_key',
    };
  }

  const derived = resolveDerivedCorrelation(input.eventName, input.payload);
  if (derived.values.length > 0) {
    return {
      key: derived.values[0]!.value,
      keys: derived.values.map((entry) => entry.value),
      source: 'derived',
      detail: `paths:${derived.values.map((entry) => entry.path).join(',')} (${derived.configSource})`,
    };
  }

  return {
    key: null,
    keys: [],
    source: 'missing',
    detail: 'no explicit key and no configured derivation path produced a value',
  };
}

function resolveExplicitCorrelation(
  explicitCorrelationKey: string | null | undefined
): string | null {
  if (typeof explicitCorrelationKey === 'string' && explicitCorrelationKey.trim()) {
    return explicitCorrelationKey.trim();
  }

  return null;
}

function resolveDerivedCorrelation(
  eventName: string,
  payload: Record<string, unknown>
): { values: Array<{ value: string; path: string }>; configSource: string } {
  const { paths, source } = getWorkflowEventCorrelationPaths(eventName);
  const values: Array<{ value: string; path: string }> = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const value = readDottedValue(payload, path);
    if (value === null || value === undefined) continue;
    const asString = String(value).trim();
    if (!asString || seen.has(asString)) continue;
    seen.add(asString);
    values.push({ value: asString, path });
  }
  return { values, configSource: source };
}

function readDottedValue(input: Record<string, unknown>, dottedPath: string): unknown {
  const path = dottedPath.split('.').filter(Boolean);
  let cursor: unknown = input;
  for (const segment of path) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}
