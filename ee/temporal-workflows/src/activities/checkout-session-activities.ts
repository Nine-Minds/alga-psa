import { Context } from '@temporalio/activity';

const logger = () => Context.current().log;

export interface UpdateCheckoutSessionStatusInput {
  checkoutSessionId: string;
  workflowStatus: 'pending' | 'started' | 'in_progress' | 'completed' | 'failed';
  workflowId?: string;
  error?: string;
}

/**
 * Updates the checkout session status in PayloadCMS
 * This activity is called at the end of the workflow to mark it as completed
 */
export async function updateCheckoutSessionStatus(
  input: UpdateCheckoutSessionStatusInput
): Promise<void> {
  const log = logger();
  log.info('Updating checkout session status', { 
    checkoutSessionId: input.checkoutSessionId,
    workflowStatus: input.workflowStatus 
  });

  try {
    // Make HTTP request to the nm-store API to update the status
    const baseUrl = process.env.NMSTORE_BASE_URL || 'http://localhost:3000';
    const apiSecret = process.env.ALGA_AUTH_KEY;
    if (!apiSecret) {
      throw new Error('ALGA_AUTH_KEY environment variable is required for authentication');
    }
    
    const response = await fetch(`${baseUrl}/api/internal/checkout-session-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': apiSecret
      },
      body: JSON.stringify({
        checkoutSessionId: input.checkoutSessionId,
        workflowStatus: input.workflowStatus,
        workflowId: input.workflowId,
        workflowCompletedAt: input.workflowStatus === 'completed' ? new Date().toISOString() : undefined,
        error: input.error
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update checkout session status: ${response.status} - ${errorText}`);
    }

    log.info('Checkout session status updated successfully', { 
      checkoutSessionId: input.checkoutSessionId,
      workflowStatus: input.workflowStatus 
    });
  } catch (error) {
    log.error('Failed to update checkout session status', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      checkoutSessionId: input.checkoutSessionId 
    });
    // Re-throw to let Temporal handle retries
    throw error;
  }
}