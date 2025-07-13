/**
 * Direct test of email processing workflow
 * This bypasses MailHog polling and directly triggers the EmailProcessor
 */

import { EmailProcessor } from './src/services/email/EmailProcessor.js';

async function testEmailProcessing() {
  console.log('🧪 Testing email processing workflow directly...');
  
  const emailProcessor = new EmailProcessor();
  
  // Create a test job similar to what MailHogPollingService would create
  const testJob = {
    id: 'test-job-123',
    messageId: 'test-message-456',
    providerId: 'mailhog-test-provider',
    tenant: '58200d41-5a72-4074-854b-a4c659ede8cc', // Use tenant from test
    attempt: 1,
    maxRetries: 3,
    createdAt: new Date().toISOString(),
    webhookData: {
      source: 'test',
      originalMessageId: 'test-original-123'
    }
  };
  
  console.log('📧 Processing test email job:', testJob);
  
  try {
    await emailProcessor.processEmail(testJob);
    console.log('✅ Email processing completed successfully!');
  } catch (error) {
    console.error('❌ Email processing failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

testEmailProcessing().catch(console.error);