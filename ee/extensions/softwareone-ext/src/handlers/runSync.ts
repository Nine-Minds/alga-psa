import { ExtensionContext, SyncResult } from '../types';
import { SyncService } from '../services/syncService';

export async function handler(
  request: Request,
  context: ExtensionContext
): Promise<Response> {
  const { storage, logger } = context;

  try {
    // Get configuration
    const config = await storage.getNamespace('swone').get('config');
    
    if (!config || !config.apiToken || !config.apiEndpoint) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'SoftwareOne API not configured. Please configure settings first.'
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Check for full sync parameter
    const url = new URL(request.url);
    const fullSync = url.searchParams.get('full') === 'true';

    logger.info('Starting SoftwareOne sync', { fullSync });

    // Create sync service and perform sync
    const syncService = new SyncService(config, context);
    const result = await syncService.performFullSync();

    return new Response(
      JSON.stringify(result),
      {
        status: result.success ? 200 : 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    logger.error('Sync endpoint error', error);
    
    const errorResult: SyncResult = {
      success: false,
      message: 'Internal server error during sync',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    };

    return new Response(
      JSON.stringify(errorResult),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}