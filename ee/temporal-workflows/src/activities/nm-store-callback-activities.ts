/**
 * NM Store Callback Activities for Temporal Workflows
 * These activities handle callbacks to nm-store when tenant operations complete
 */

import { Context } from '@temporalio/activity';
import crypto from 'crypto';

const logger = () => Context.current().log;

export interface CallbackToNmStoreInput {
  sessionId: string;
  algaTenantId?: string;
  status: 'completed' | 'failed';
  error?: string;
}

/**
 * Callback to nm-store with tenant creation results
 * This allows nm-store to store the Alga tenant ID for future license syncs
 */
export async function callbackToNmStore(
  input: CallbackToNmStoreInput
): Promise<void> {
  const log = logger();
  log.info('Calling back to nm-store', { 
    sessionId: input.sessionId,
    status: input.status,
    algaTenantId: input.algaTenantId 
  });

  try {
    const nmStoreUrl = process.env.NM_STORE_URL || 'http://localhost:3000';
    const webhookSecret = process.env.TEMPORAL_WEBHOOK_SECRET;
    
    if (!webhookSecret) {
      log.warn('TEMPORAL_WEBHOOK_SECRET not configured, skipping callback');
      return;
    }
    
    const payload = JSON.stringify(input);
    const signature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');
    
    const response = await fetch(`${nmStoreUrl}/api/webhooks/temporal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Temporal-Signature': signature,
      },
      body: payload,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Callback failed: ${response.status} - ${errorText}`);
    }
    
    log.info('Successfully called back to nm-store', { 
      sessionId: input.sessionId,
      algaTenantId: input.algaTenantId 
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to callback to nm-store', { 
      error: errorMessage,
      sessionId: input.sessionId 
    });
    // Re-throw the error to trigger Temporal's retry mechanism
    // The workflow has a try-catch that will handle final failure gracefully
    throw error;
  }
}