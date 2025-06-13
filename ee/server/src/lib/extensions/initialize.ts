import path from 'path';
import { getExtensionLoader } from './loader';
import logger from '@shared/core/logger';

export async function initializeExtensions(): Promise<void> {
  try {
    logger.info('Initializing extension system');
    
    // Get the extensions directory path
    const extensionsDir = path.join(process.cwd(), 'extensions');
    
    // Create and use the extension loader
    const loader = getExtensionLoader(extensionsDir);
    await loader.loadExtensions();
    
    logger.info('Extension system initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize extension system', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    // Don't throw - allow the app to start even if extensions fail to load
  }
}