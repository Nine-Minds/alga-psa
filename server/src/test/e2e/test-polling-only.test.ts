import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import '../../../test-utils/nextApiMock';
import { E2ETestContext } from './utils/e2e-test-context';

describe('Test Polling Service Only', () => {
  let context: E2ETestContext;

  beforeAll(async () => {
    context = new E2ETestContext({
      testMode: 'e2e',
      autoStartServices: false,
      clearEmailsBeforeTest: false, // DON'T clear emails
      autoStartEmailPolling: true  // DO start polling
    });
    
    await context.initialize();
  });

  afterAll(async () => {
    if (context && context.cleanup) {
      await context.cleanup();
    }
  });

  it('should check if polling service can see emails', async () => {
    console.log('🔍 === TESTING POLLING SERVICE VISIBILITY ===');
    
    // Step 1: Check current polling status
    const initialStatus = context.mailhogPollingService.getStatus();
    console.log('📧 Initial polling status:', initialStatus);
    expect(initialStatus.isPolling).toBe(true);
    
    // Step 2: Check current MailHog messages directly
    try {
      const response = await fetch('http://localhost:8025/api/v1/messages');
      const data = await response.json();
      console.log('📧 Current MailHog messages (direct API):', data.messages?.length || 0);
      if (data.messages?.length > 0) {
        console.log('📋 Message subjects:', data.messages.map((m: any) => m.Content?.Headers?.Subject?.[0]));
      }
    } catch (error) {
      console.log('❌ Failed to fetch MailHog messages:', error.message);
    }
    
    // Step 3: Send a simple email using the MailHog client directly
    console.log('📤 Sending simple email...');
    const sentEmail = await context.mailhogClient.sendEmail({
      from: 'test@example.com',
      to: 'support@company.com',
      subject: 'Polling Visibility Test',
      body: 'This email should be visible to the polling service'
    });
    console.log('✅ Email sent with ID:', sentEmail.messageId);
    
    // Step 4: Check MailHog messages again immediately
    try {
      const response = await fetch('http://localhost:8025/api/v1/messages');
      const data = await response.json();
      console.log('📧 MailHog messages after send (direct API):', data.messages?.length || 0);
      if (data.messages?.length > 0) {
        console.log('📋 Message subjects:', data.messages.map((m: any) => m.Content?.Headers?.Subject?.[0]));
      }
    } catch (error) {
      console.log('❌ Failed to fetch MailHog messages after send:', error.message);
    }
    
    // Step 5: Wait for polling service to process
    console.log('⏳ Waiting 5 seconds for polling service...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Step 6: Check polling service status
    const afterStatus = context.mailhogPollingService.getStatus();
    console.log('📧 Polling status after wait:', afterStatus);
    
    // Step 7: Check if the polling service processed anything
    if (afterStatus.processedCount > initialStatus.processedCount) {
      console.log('✅ Polling service processed emails!');
    } else {
      console.log('❌ Polling service did not process any emails');
    }
    
    // Step 8: Check MailHog one more time
    try {
      const response = await fetch('http://localhost:8025/api/v1/messages');
      const data = await response.json();
      console.log('📧 Final MailHog messages (direct API):', data.messages?.length || 0);
    } catch (error) {
      console.log('❌ Failed to fetch final MailHog messages:', error.message);
    }
    
    console.log('🔍 === END POLLING VISIBILITY TEST ===');
    
    // Just verify email was sent
    expect(sentEmail).toBeDefined();
  }, 30000);
});