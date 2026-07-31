/**
 * Community Edition stub of the AI gateway admin-notification helpers.
 *
 * The real implementation lives in ee/server/src/lib/aiGateway/notifications.ts
 * and is substituted at EE build time via the `@alga-psa/ee-stubs` webpack
 * alias. It depends on the server notification stack, which would create an
 * ee-stubs -> notifications project cycle if imported here, so this stub only
 * logs. CE installs have no AI add-on, making the notice unreachable anyway.
 */

import logger from '@alga-psa/core/logger';

import type { AiCreditsError, AiFeature } from './types';

type BackgroundAiFeature = Exclude<AiFeature, 'chat' | 'chat-title'>;

export async function notifyAiCreditsUnavailable(
  tenantId: string,
  feature: BackgroundAiFeature,
  error: AiCreditsError,
): Promise<void> {
  logger.warn('[aiGateway] AI credits unavailable (admin notification requires Enterprise Edition)', {
    tenantId,
    feature,
    reason: error.reason,
  });
}
