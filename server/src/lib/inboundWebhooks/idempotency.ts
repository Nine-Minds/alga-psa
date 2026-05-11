import { evaluateExpressionSource } from '@alga-psa/workflows/runtime/expressionEngine';
import type { InboundWebhookIdempotencySource } from './types';

export async function extractInboundWebhookIdempotencyKey(args: {
  source: InboundWebhookIdempotencySource | null;
  headers: Headers | Record<string, string | string[] | undefined>;
  body: unknown;
}): Promise<string | null> {
  if (!args.source) {
    return null;
  }

  if (args.source.type === 'header') {
    return extractHeaderValue(args.headers, args.source.value);
  }

  const result = await evaluateExpressionSource(
    args.source.value,
    args.body && typeof args.body === 'object' ? (args.body as Record<string, unknown>) : { value: args.body },
  );

  if (result === null || result === undefined) {
    return null;
  }

  const key = String(result).trim();
  return key.length > 0 ? key : null;
}

function extractHeaderValue(
  headers: Headers | Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  if (headers instanceof Headers) {
    const value = headers.get(name);
    return value?.trim() || null;
  }

  const requested = name.toLowerCase();
  for (const [headerName, value] of Object.entries(headers)) {
    if (headerName.toLowerCase() !== requested || !value) {
      continue;
    }

    const normalized = Array.isArray(value) ? value[0] : value;
    return normalized?.trim() || null;
  }

  return null;
}
