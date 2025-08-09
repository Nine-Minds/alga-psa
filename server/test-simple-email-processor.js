/**
 * Simple test to check EmailProcessor without MailHog polling
 */

console.log('🧪 Testing EmailProcessor directly...');

async function testEmailProcessor() {
  try {
    console.log('📧 Importing EmailProcessor...');
    const { EmailProcessor } = await import('./src/services/email/EmailProcessor.js');
    
    console.log('✅ EmailProcessor imported successfully');
    
    const processor = new EmailProcessor();
    console.log('✅ EmailProcessor instantiated');
    
    // Try to process a simple test job
    const testJob = {
      id: 'test-job-123',
      messageId: 'test-message-456',
      providerId: 'mailhog-test-provider',
      tenant: 'test-tenant',
      attempt: 1,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      webhookData: { source: 'test' }
    };
    
    console.log('📧 Processing test job...');
    await processor.processEmail(testJob);
    console.log('✅ EmailProcessor completed');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

testEmailProcessor();