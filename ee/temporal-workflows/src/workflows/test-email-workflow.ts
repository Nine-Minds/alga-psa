import { proxyActivities } from '@temporalio/workflow';
import type { SendWelcomeEmailActivityInput, SendWelcomeEmailActivityResult } from '../types/workflow-types';

// Define activity proxies for the test
const { generateTemporaryPassword, sendWelcomeEmail } = proxyActivities<{
  generateTemporaryPassword(length?: number): Promise<string>;
  sendWelcomeEmail(input: SendWelcomeEmailActivityInput): Promise<SendWelcomeEmailActivityResult>;
}>({
  startToCloseTimeout: '1m',
  retry: {
    maximumAttempts: 3,
  },
});

/**
 * Simple test workflow for E2E testing - demonstrates proper workflow/activity separation
 * This workflow orchestrates the email sending process by:
 * 1. Generating a temporary password (activity - non-deterministic)
 * 2. Sending welcome email (activity - external call)
 */
export async function testEmailWorkflow(input: SendWelcomeEmailActivityInput) {
  // Generate a secure password via activity (non-deterministic operation)
  const temporaryPassword = await generateTemporaryPassword(12);
  
  // Update input with generated password
  const updatedInput = {
    ...input,
    temporaryPassword,
  };
  
  // Send welcome email via activity (external call)
  const emailResult = await sendWelcomeEmail(updatedInput);
  
  return {
    temporaryPassword,
    emailResult,
  };
}