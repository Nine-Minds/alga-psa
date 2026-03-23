import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import type { WorkflowJsonSchema } from '../../../../shared/workflow/runtime/ai/aiSchema';

import { resolveChatProvider, type ChatProviderId, type ResolvedChatProvider } from './chatProviderResolver';

const WORKFLOW_AI_SYSTEM_PROMPT =
  'You generate structured JSON for workflow automation. Follow the provided JSON Schema exactly and do not include markdown or extra commentary.';
const MAX_RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_BASE_DELAY_MS = 500;
const RATE_LIMIT_MAX_DELAY_MS = 5000;

const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  strict: false,
});
addFormats(ajv);

export class WorkflowInferenceServiceError extends Error {
  category: 'ValidationError' | 'ActionError' | 'TransientError';
  code: string;
  details?: Record<string, unknown>;

  constructor(params: {
    category: 'ValidationError' | 'ActionError' | 'TransientError';
    code: string;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = 'WorkflowInferenceServiceError';
    this.category = params.category;
    this.code = params.code;
    this.details = params.details;
  }
}

export type WorkflowStructuredOutputRequest = {
  prompt: string;
  schema: WorkflowJsonSchema;
  providerOverride?: ChatProviderId;
  tenantId?: string | null;
  runId: string;
  stepPath: string;
};

const isRateLimitError = (error: unknown): boolean => {
  const status = typeof (error as { status?: unknown })?.status === 'number'
    ? Number((error as { status?: number }).status)
    : null;
  const code = typeof (error as { code?: unknown })?.code === 'string'
    ? String((error as { code?: string }).code).toLowerCase()
    : '';
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return status === 429 || code.includes('rate_limit') || message.includes('rate limit');
};

const readRetryDelayMs = (error: unknown, attempt: number): number => {
  const retryAfterRaw =
    typeof (error as { headers?: { get?: (name: string) => string | null } })?.headers?.get === 'function'
      ? (error as { headers?: { get?: (name: string) => string | null } }).headers?.get?.('retry-after')
      : null;
  const retryAfterSeconds = retryAfterRaw ? Number(retryAfterRaw) : Number.NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, RATE_LIMIT_MAX_DELAY_MS);
  }

  return Math.min(RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt, RATE_LIMIT_MAX_DELAY_MS);
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const readStructuredContent = (completion: {
  choices?: Array<{ message?: { content?: unknown } }>;
}): string => {
  const content = completion.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) {
    return content;
  }

  throw new WorkflowInferenceServiceError({
    category: 'ActionError',
    code: 'AI_EMPTY_RESPONSE',
    message: 'AI inference returned an empty response.',
  });
};

const normalizeProviderError = (
  error: unknown,
  provider: ResolvedChatProvider | null,
  request: Pick<WorkflowStructuredOutputRequest, 'runId' | 'stepPath'>
): WorkflowInferenceServiceError => {
  if (error instanceof WorkflowInferenceServiceError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const details = {
    providerId: provider?.providerId ?? null,
    model: provider?.model ?? null,
    runId: request.runId,
    stepPath: request.stepPath,
  };

  if (/not configured|requires google adc|missing configuration/i.test(message)) {
    return new WorkflowInferenceServiceError({
      category: 'ActionError',
      code: 'AI_PROVIDER_NOT_CONFIGURED',
      message: `AI provider is not configured: ${message}`,
      details,
    });
  }

  if (isRateLimitError(error)) {
    return new WorkflowInferenceServiceError({
      category: 'TransientError',
      code: 'AI_RATE_LIMITED',
      message: 'AI inference was rate-limited by the provider.',
      details,
    });
  }

  return new WorkflowInferenceServiceError({
    category: 'ActionError',
    code: 'AI_PROVIDER_REQUEST_FAILED',
    message: message || 'AI inference request failed.',
    details,
  });
};

const validateSchemaCompiles = (schema: WorkflowJsonSchema): void => {
  try {
    ajv.compile(schema);
  } catch (error) {
    throw new WorkflowInferenceServiceError({
      category: 'ValidationError',
      code: 'AI_OUTPUT_SCHEMA_INVALID',
      message: error instanceof Error ? error.message : 'AI output schema failed validation.',
    });
  }
};

const validateStructuredOutput = (schema: WorkflowJsonSchema, output: unknown): void => {
  const validate = ajv.compile(schema);
  if (validate(output)) return;

  throw new WorkflowInferenceServiceError({
    category: 'ValidationError',
    code: 'AI_OUTPUT_VALIDATION_FAILED',
    message: 'AI inference output did not match the declared schema.',
    details: {
      errors: validate.errors ?? [],
    },
  });
};

const createStructuredOutputRequest = (
  provider: ResolvedChatProvider,
  request: WorkflowStructuredOutputRequest
) => ({
  model: provider.model,
  messages: [
    { role: 'system' as const, content: WORKFLOW_AI_SYSTEM_PROMPT },
    { role: 'user' as const, content: request.prompt },
  ],
  response_format: {
    type: 'json_schema' as const,
    json_schema: {
      name: 'workflow_ai_output',
      strict: true,
      schema: request.schema,
    },
  },
  ...provider.requestOverrides.resolveTurnOverrides(),
});

export async function inferWorkflowStructuredOutput(
  request: WorkflowStructuredOutputRequest
): Promise<Record<string, unknown>> {
  validateSchemaCompiles(request.schema);

  let provider: ResolvedChatProvider | null = null;

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      provider = await resolveChatProvider(request.providerOverride);
      const completion = await provider.client.chat.completions.create(
        createStructuredOutputRequest(provider, request)
      );
      const content = readStructuredContent(completion);

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (error) {
        throw new WorkflowInferenceServiceError({
          category: 'ValidationError',
          code: 'AI_OUTPUT_JSON_INVALID',
          message: error instanceof Error ? error.message : 'AI inference returned invalid JSON.',
        });
      }

      validateStructuredOutput(request.schema, parsed);

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new WorkflowInferenceServiceError({
          category: 'ValidationError',
          code: 'AI_OUTPUT_ROOT_INVALID',
          message: 'AI inference must return a JSON object.',
        });
      }

      return parsed as Record<string, unknown>;
    } catch (error) {
      if (attempt < MAX_RATE_LIMIT_RETRIES && isRateLimitError(error)) {
        await sleep(readRetryDelayMs(error, attempt));
        continue;
      }

      throw normalizeProviderError(error, provider, request);
    }
  }

  throw new WorkflowInferenceServiceError({
    category: 'TransientError',
    code: 'AI_RATE_LIMITED',
    message: 'AI inference exhausted provider retry attempts.',
  });
}
