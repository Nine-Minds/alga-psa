import logger from '@alga-psa/core/logger';
import {
  getExpressionAdmissionStats,
  setExpressionAdmissionSink,
  type ExpressionAdmissionEvent,
} from './expressionEngine';

/**
 * Node-only telemetry for expression admission, using the project logger and
 * its existing `[metric] <name>` structured-line convention (see
 * server/src/lib/api/rateLimit/enforce.ts). Kept out of expressionEngine.ts
 * because that file is bundled into Temporal's workflow sandbox.
 *
 * Gauges (queue depth, wait time, active slots) are carried on every event and
 * readable via getExpressionAdmissionStats(); every rejection emits exactly one
 * warn line.
 */
export function logExpressionAdmissionEvent(event: ExpressionAdmissionEvent): void {
  switch (event.type) {
    case 'busy':
      logger.warn('[metric] workflow.expression.busy_rejection', { ...event });
      break;
    case 'deadline_exceeded':
      logger.warn('[metric] workflow.expression.deadline_exceeded', { ...event });
      break;
    case 'rate_limited':
      logger.warn('[metric] workflow.expression.rate_limited', { ...event });
      break;
    case 'acquired':
      // Waits worth noticing only; the steady state is covered by the stats gauges.
      if (event.waitedMs > 0) logger.debug('[metric] workflow.expression.slot_wait', { ...event });
      break;
    default:
      break;
  }
}

let installed = false;

/** Idempotent. Call from node entry points that evaluate workflow expressions. */
export function installExpressionAdmissionTelemetry(): void {
  if (installed) return;
  installed = true;
  setExpressionAdmissionSink(logExpressionAdmissionEvent);
}

export { getExpressionAdmissionStats };
