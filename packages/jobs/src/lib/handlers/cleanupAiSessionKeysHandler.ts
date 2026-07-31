import logger from '@alga-psa/core/logger';

export interface CleanupAiSessionKeysJobData {
  tenantId: string;
  trigger?: 'cron' | 'manual';
  [key: string]: unknown;
}

export async function cleanupAiSessionKeysHandler(): Promise<void> {
  if (process.env.EDITION !== 'enterprise') {
    return;
  }

  try {
    const chatEntryModule = '@product/chat/entry';
    const { TemporaryApiKeyService } = await import(chatEntryModule);

    if (!TemporaryApiKeyService || typeof TemporaryApiKeyService.cleanupExpiredAiKeys !== 'function') {
      logger.warn('[cleanupAiSessionKeysHandler] TemporaryApiKeyService unavailable; skipping cleanup');
      return;
    }

    const deactivated = await TemporaryApiKeyService.cleanupExpiredAiKeys();
    if (deactivated > 0) {
      logger.info(`[cleanupAiSessionKeysHandler] Deactivated ${deactivated} expired AI session keys.`);
    }
  } catch (error) {
    logger.error('[cleanupAiSessionKeysHandler] Failed to clean up AI session keys', error);
  }
}
