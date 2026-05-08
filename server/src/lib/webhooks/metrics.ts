import logger from '@alga-psa/core/logger';

export function emitWebhookMetric(
  metric: string,
  payload: Record<string, unknown>,
  level: 'info' | 'warn' = 'info',
): void {
  logger[level](`[metric] ${metric}`, payload);
}
