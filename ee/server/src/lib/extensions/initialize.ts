import logger from '@alga-psa/core/logger';

export async function initializeExtensions(): Promise<void> {
  try {
    logger.info('Initializing extension system');
  
    // Legacy filesystem scan removed per multi-tenancy overhaul.
    // Registry-driven installs will be resolved on-demand by the API gateway.
    logger.info('Extension system initialized (legacy scan disabled)');
  } catch (error) {
    logger.error('Failed to initialize extension system', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    // Don't throw - allow the app to start even if extensions fail to load
  }
}
