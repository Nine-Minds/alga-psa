import { AiCreditsError, type AiCreditsErrorReason } from './types';

const AI_CREDITS_REASONS = new Set<AiCreditsErrorReason>([
  'no_subscription',
  'out_of_credits',
  'consent_required',
]);

function readReason(value: unknown): AiCreditsErrorReason | null {
  if (typeof value === 'string' && AI_CREDITS_REASONS.has(value as AiCreditsErrorReason)) {
    return value as AiCreditsErrorReason;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  return (
    readReason(record.code) ??
    readReason(record.reason) ??
    readReason(record.error) ??
    readReason(record.body)
  );
}

/** Normalize a gateway rejection, including the OpenAI SDK's APIError shape. */
export function toAiCreditsError(error: unknown): AiCreditsError | null {
  if (error instanceof AiCreditsError) {
    return error;
  }

  if (!error || typeof error !== 'object') {
    return null;
  }

  const record = error as Record<string, unknown>;
  if (record.status !== 402) {
    return null;
  }

  const reason = readReason(record);
  if (!reason) {
    return null;
  }

  const message = error instanceof Error ? error.message : undefined;
  return new AiCreditsError(reason, message);
}
