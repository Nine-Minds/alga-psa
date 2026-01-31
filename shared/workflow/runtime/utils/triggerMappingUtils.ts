import type { ExpressionContext } from '../expressionEngine';

export type TriggerMappingExpressionContextEvent = {
  name: string | null;
  correlationKey?: string | null;
  payload: Record<string, unknown>;
  payloadSchemaRef: string | null;
};

export function buildTriggerMappingExpressionContext(
  event: TriggerMappingExpressionContextEvent
): ExpressionContext {
  return {
    event: {
      name: event.name,
      correlationKey: event.correlationKey ?? null,
      payload: event.payload,
      payloadSchemaRef: event.payloadSchemaRef,
    },
  };
}

export function expandDottedKeys(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key.includes('.')) {
      result[key] = value;
      continue;
    }
    const parts = key.split('.').filter(Boolean);
    if (parts.length === 0) continue;
    let cursor: Record<string, unknown> = result;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLeaf = i === parts.length - 1;
      if (isLeaf) {
        cursor[part] = value;
        continue;
      }
      const existing = cursor[part];
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        cursor = existing as Record<string, unknown>;
        continue;
      }
      const next: Record<string, unknown> = {};
      cursor[part] = next;
      cursor = next;
    }
  }
  return result;
}

export function mappingUsesSecretRefs(value: unknown): boolean {
  if (!value) return false;
  if (Array.isArray(value)) return value.some(mappingUsesSecretRefs);
  if (typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.$secret === 'string' && obj.$secret.trim().length > 0) return true;
  return Object.values(obj).some(mappingUsesSecretRefs);
}

