import type {
  SharedExpressionContextRoot,
  SharedExpressionPathOption,
  SharedExpressionSchemaNode,
} from '../context';
import type { ExpressionMode } from '../modes';
import { buildPathOptionsFromContextRoots } from '../pathDiscovery';

function inferSchema(value: unknown): SharedExpressionSchemaNode {
  if (value === null) {
    return { type: 'null' };
  }

  if (Array.isArray(value)) {
    return {
      type: 'array',
      items: inferArrayItemSchema(value),
    };
  }

  switch (typeof value) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: Number.isInteger(value) ? 'integer' : 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'object':
      return {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => [key, inferSchema(nested)]),
        ),
      };
    default:
      return { type: 'unknown' };
  }
}

function inferArrayItemSchema(values: unknown[]): SharedExpressionSchemaNode {
  const firstNonNull = values.find((value) => value !== null && value !== undefined);
  return firstNonNull === undefined ? { type: 'unknown' } : inferSchema(firstNonNull);
}

export function buildWebhookPayloadExpressionContextRoots(samplePayload: unknown): SharedExpressionContextRoot[] {
  if (!samplePayload || typeof samplePayload !== 'object' || Array.isArray(samplePayload)) {
    return [
      {
        key: 'value',
        label: 'Payload',
        description: 'Webhook request body',
        schema: inferSchema(samplePayload),
        allowInModes: ['path-only', 'template'],
      },
    ];
  }

  return Object.entries(samplePayload as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({
      key,
      label: key,
      description: 'Webhook request body field',
      schema: inferSchema(value),
      allowInModes: ['path-only', 'template'],
    }));
}

export function buildWebhookPayloadExpressionPathOptions(
  samplePayload: unknown,
  params: {
    mode?: ExpressionMode;
    includeRootPaths?: boolean;
  } = {},
): SharedExpressionPathOption[] {
  return buildPathOptionsFromContextRoots(
    buildWebhookPayloadExpressionContextRoots(samplePayload),
    params,
  );
}
