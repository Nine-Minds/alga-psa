import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import '../../../test-utils/nextApiMock';
import { E2ETestContext } from './utils/e2e-test-context';

describe('Manual Debug Email Processing', () => {
  let context: E2ETestContext;

  beforeAll(async () => {
    // Create context without auto-starting services since they're already running
    context = new E2ETestContext({
      runSeeds: true,
      testMode: 'e2e',
      autoStartServices: false, // Don't try to start Docker services
      clearEmailsBeforeTest: true,
      autoStartEmailPolling: true
    });
    
    // Initialize manually
    await context.initialize();
  });

  afterAll(async () => {
    if (context && context.cleanup) {
      await context.cleanup();
    }
  });

  it('should trace email processing step by step', async () => {
    console.log('🔍 === MANUAL DEBUG EMAIL PROCESSING ===');
    
    // Step 1: Check MailHog polling service
    const pollingStatus = context.mailhogPollingService.getStatus();
    console.log('📧 MailHog Polling Service Status:', pollingStatus);
    expect(pollingStatus.isPolling).toBe(true);
    
    // Step 2: Verify services are responding
    try {
      const mailhogResponse = await fetch('http://localhost:8025/api/v1/messages');
      console.log('📧 MailHog API Status:', mailhogResponse.status);
      
      const workflowResponse = await fetch('http://localhost:4001/health');
      const workflowHealth = await workflowResponse.json();
      console.log('🔄 Workflow Worker Health:', workflowHealth);
    } catch (error) {
      console.log('❌ Service check failed:', error.message);
    }
    
    // Step 3: Create test data
    console.log('🏗️ Creating test data...');
    const { tenant, company, contact } = await context.emailTestFactory.createBasicEmailScenario();
    console.log('📋 Test data:', {
      tenant: tenant.tenant,
      company: company.company_name,
      contact: contact.email
    });
    
    // Step 4: Clear MailHog before test
    await context.mailhogClient.clearMessages();
    console.log('🧹 MailHog cleared');
    
    // Step 5: Check database before
    const beforeTickets = await context.db('tickets').count('* as count').first();
    console.log('🎫 Tickets before:', beforeTickets.count);
    
    // Step 6: Send email and trace
    console.log('📤 Sending email...');
    const testEmail = {
      from: contact.email,
      to: 'support@company.com',
      subject: 'Manual Debug Test',
      body: 'This is a manual debug test email.'
    };
    
    const { sentEmail, capturedEmail } = await context.sendAndCaptureEmail(testEmail);
    console.log('✅ Email sent and captured');
    console.log('📧 Sent email ID:', sentEmail.messageId);
    console.log('📧 Captured subject:', capturedEmail.Content.Headers.Subject[0]);
    
    // Step 7: Force polling service to process immediately
    console.log('⏳ Waiting 10 seconds for processing...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Step 8: Check polling service status again
    const statusAfter = context.mailhogPollingService.getStatus();
    console.log('📧 Polling status after wait:', statusAfter);
    
    // Step 9: Check for any new workflow events
    const workflowEvents = await context.db('workflow_events')
      .where('created_at', '>', new Date(Date.now() - 60000)) // Last minute
      .orderBy('created_at', 'desc');
    console.log('🔄 Recent workflow events:', workflowEvents.length);
    if (workflowEvents.length > 0) {
      console.log('📊 Latest events:', workflowEvents.slice(0, 3));
    }
    
    // Step 10: Check for tickets
    const afterTickets = await context.db('tickets')
      .where('created_at', '>', new Date(Date.now() - 60000))
      .leftJoin('contacts', 'tickets.contact_name_id', 'contacts.contact_name_id')
      .select('tickets.*', 'contacts.email as contact_email');
    console.log('🎫 Recent tickets:', afterTickets.length);
    if (afterTickets.length > 0) {
      console.log('📋 Ticket details:', afterTickets);
    }
    
    // Step 11: Test the EventBus directly
    console.log('🧪 Testing EventBus directly...');
    try {
      const { getEventBus } = await import('../../lib/eventBus');
      const eventBus = getEventBus();
      
      // Test publishing an INBOUND_EMAIL_RECEIVED event manually
      await eventBus.publish({
        eventType: 'INBOUND_EMAIL_RECEIVED',
        payload: {
          tenantId: tenant.tenant,
          providerId: 'test-provider',
          emailData: {
            id: 'test-email-123',
            subject: 'Direct EventBus Test',
            from: { email: contact.email, name: 'Test User' },
            to: [{ email: 'support@company.com', name: 'Support' }],
            body: { text: 'Direct test email body' },
            receivedAt: new Date().toISOString(),
            attachments: []
          }
        }
      });
      console.log('✅ Direct EventBus test event published');
      
      // Wait a bit more for workflow processing
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Check again for workflow events
      const eventsAfterDirect = await context.db('workflow_events')
        .where('created_at', '>', new Date(Date.now() - 30000))
        .orderBy('created_at', 'desc');
      console.log('🔄 Events after direct publish:', eventsAfterDirect.length);
      
    } catch (error) {
      console.log('❌ EventBus direct test failed:', error.message);
      console.log('📊 Error details:', error);
    }
    
    console.log('🔍 === END MANUAL DEBUG ===');
    
    // Basic test - just verify email capture works
    expect(sentEmail).toBeDefined();
    expect(capturedEmail).toBeDefined();
  }, 60000); // 60 second timeout
});