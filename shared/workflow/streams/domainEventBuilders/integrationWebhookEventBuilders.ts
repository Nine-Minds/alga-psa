const DEFAULT_SENSITIVE_KEY_PATTERN = /(secret|token|password|api[_-]?key|authorization|signature)/i;

function safeJsonClone(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return '[UNSERIALIZABLE]';
  }
}

function redactSensitiveKeys(
  value: unknown,
  options: { sensitiveKeyPattern: RegExp; redactValue: string }
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveKeys(entry, options));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (key === 'secretRef' || key === '$secret' || options.sensitiveKeyPattern.test(key)) {
      result[key] = options.redactValue;
      continue;
    }
    result[key] = redactSensitiveKeys(val, options);
  }
  return result;
}

export function sanitizeIntegrationWebhookRawPayload(
  rawPayload: unknown,
  options?: { maxBytes?: number; sensitiveKeyPattern?: RegExp; redactValue?: string }
): { snapshot: unknown; truncated: boolean; originalSize: number; maxBytes: number } {
  const maxBytes = options?.maxBytes ?? 10_000;
  const sensitiveKeyPattern = options?.sensitiveKeyPattern ?? DEFAULT_SENSITIVE_KEY_PATTERN;
  const redactValue = options?.redactValue ?? '***';

  const cloned = safeJsonClone(rawPayload);
  const redacted = redactSensitiveKeys(cloned, { sensitiveKeyPattern, redactValue });
  const serialized = JSON.stringify(redacted);

  if (serialized.length <= maxBytes) {
    return { snapshot: redacted, truncated: false, originalSize: serialized.length, maxBytes };
  }

  return {
    snapshot: { truncated: true, size: serialized.length, max: maxBytes },
    truncated: true,
    originalSize: serialized.length,
    maxBytes,
  };
}

export function buildIntegrationWebhookReceivedPayload(params: {
  integrationId: string;
  provider: string;
  connectionId?: string;
  webhookId: string;
  eventName: string;
  receivedAt?: string;
  rawPayloadRef?: string;
}) {
  return {
    integrationId: params.integrationId,
    provider: params.provider,
    connectionId: params.connectionId,
    webhookId: params.webhookId,
    eventName: params.eventName,
    receivedAt: params.receivedAt,
    rawPayloadRef: params.rawPayloadRef,
  };
}

