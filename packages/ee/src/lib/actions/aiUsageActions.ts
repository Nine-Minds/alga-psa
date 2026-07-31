/**
 * CE stub for the AI usage server actions consumed by CE-tree components.
 *
 * The real, deployment-aware implementation lives in
 * `ee/server/src/lib/actions/aiUsageActions.ts` (EE-only) and is resolved via
 * the `@ee` alias at EE build/runtime. In Community Edition builds `@ee`
 * resolves here. Only the surface used by CE-tree callers (the appliance AI
 * section) is stubbed; the full contract lives in the EE module.
 */
'use server';

import logger from '@alga-psa/core/logger';
import type { AiAccountSummary } from '../aiGateway/types';

export async function getAiAccountSummary(): Promise<AiAccountSummary> {
  logger.warn('[CE] getAiAccountSummary called but the AI add-on is Enterprise-only');
  throw new Error('The AI add-on is only available in Enterprise Edition.');
}
