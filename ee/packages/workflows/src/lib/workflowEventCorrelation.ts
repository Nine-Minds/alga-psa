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
      detail: `path:${derived.path}`,
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
): { value: string; path: string } | null {
  const configuredPaths = getConfiguredCorrelationPaths(eventName);
  for (const path of configuredPaths) {
    const value = readDottedValue(payload, path);
    if (value === null || value === undefined) continue;
    const asString = String(value).trim();
    if (!asString) continue;
    return { value: asString, path };
  }
  return null;
}

function getConfiguredCorrelationPaths(eventName: string): string[] {
  const raw = process.env.WORKFLOW_RUNTIME_V2_EVENT_CORRELATION_PATHS_JSON;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const eventPaths = parsed[eventName];
    const wildcardPaths = parsed['*'];
    return normalizePathConfig(eventPaths).concat(normalizePathConfig(wildcardPaths));
  } catch {
    return [];
  }
}

function normalizePathConfig(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
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
