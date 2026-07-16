import { getWorkflowEventCorrelationPaths } from '@alga-psa/shared/workflow/runtime';

export type WorkflowEventCorrelationResolution = {
  key: string | null;
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
      source: 'explicit',
      detail: 'event.workflow_correlation_key',
    };
  }

  const derived = resolveDerivedCorrelation(input.eventName, input.payload);
  if (derived) {
    return {
      key: derived.value,
      source: 'derived',
      detail: `path:${derived.path} (${derived.configSource})`,
    };
  }

  return {
    key: null,
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
): { value: string; path: string; configSource: string } | null {
  const { paths, source } = getWorkflowEventCorrelationPaths(eventName);
  for (const path of paths) {
    const value = readDottedValue(payload, path);
    if (value === null || value === undefined) continue;
    const asString = String(value).trim();
    if (!asString) continue;
    return { value: asString, path, configSource: source };
  }
  return null;
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
