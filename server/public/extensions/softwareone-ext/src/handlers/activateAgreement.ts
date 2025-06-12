import { ExtensionContext } from '../types';
import { SoftwareOneClient } from '../api/softwareOneClient';
import { SyncService } from '../services/syncService';

export async function handler(
  request: Request,
  context: ExtensionContext
): Promise<Response> {
  const { storage, logger } = context;

  try {
    // Parse request body
    const body = await request.json();
    const { agreementId } = body;

    if (!agreementId) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Agreement ID is required'
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Get configuration
    const config = await storage.getNamespace('swone').get('config');
    
    if (!config || !config.apiToken || !config.apiEndpoint) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'SoftwareOne API not configured'
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    logger.info('Activating agreement', { agreementId });

    // Create client and activate agreement
    const client = new SoftwareOneClient(config);
    const activatedAgreement = await client.activateAgreement(agreementId);

    // Update cache with new agreement data
    const syncService = new SyncService(config, context);
    await syncService.refreshAgreement(agreementId);

    logger.info('Agreement activated successfully', { agreementId });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Agreement activated successfully',
        agreement: activatedAgreement
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    logger.error('Activate agreement error', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to activate agreement'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}