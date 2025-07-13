/**
 * Simple test to verify MailHog polling is working
 */

import { MailHogPollingService } from './src/services/email/MailHogPollingService';
import { MailHogClient } from './src/test/e2e/utils/mailhog-client';

async function testMailHogPolling() {
  console.log('🧪 Testing MailHog polling service...');
  
  // Create MailHog client and clear any existing messages
  const mailhogClient = new MailHogClient();
  await mailhogClient.clearMessages();
  console.log('✅ Cleared existing emails');
  
  // Create polling service
  const pollingService = new MailHogPollingService({
    pollIntervalMs: 2000, // Poll every 2 seconds
    mailhogApiUrl: 'http://localhost:8025/api/v1'
  });
  
  console.log('📧 Starting MailHog polling...');
  pollingService.startPolling();
  
  // Wait a moment for the initial poll
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Send a test email
  console.log('📧 Sending test email...');
  const sentEmail = await mailhogClient.sendEmail({
    from: 'test@example.com',
    to: 'support@example.com',
    subject: 'Test polling email',
    body: 'This email should be detected by the polling service'
  });
  
  console.log(`✅ Email sent with ID: ${sentEmail.messageId}`);
  
  // Wait for polling to detect it
  console.log('⏳ Waiting for polling service to detect and process email...');
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  // Check polling service status
  const status = pollingService.getStatus();
  console.log('📊 Polling service status:', status);
  
  // Stop polling
  console.log('🛑 Stopping polling service...');
  pollingService.stopPolling();
  
  console.log('✅ Test completed!');
}

testMailHogPolling().catch(console.error);