import { SourceRegistry } from './registry';
import { QboCustomerImporter } from './qbo/QboCustomerImporter';
import logger from '@shared/core/logger';

/**
 * Initialize import/export sources and register importers
 */
export async function initializeImportSources(): Promise<void> {
  try {
    const registry = SourceRegistry.getInstance();
    
    // Register QBO customer importer
    registry.registerImporter('qbo', QboCustomerImporter as any);
    
    logger.info('Import sources initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize import sources:', error);
    throw error;
  }
}