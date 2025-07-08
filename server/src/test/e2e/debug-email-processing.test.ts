import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import '../../../test-utils/nextApiMock';
import { E2ETestContext } from './utils/e2e-test-context';

describe('Debug Email Processing', () => {
  const testHelpers = E2ETestContext.createE2EHelpers();
  let context: E2ETestContext;

  beforeAll(async () => {
    context = await testHelpers.beforeAll({
      runSeeds: true,
      testMode: 'e2e',
      autoStartServices: true,
      clearEmailsBeforeTest: true,
      autoStartEmailPolling: true
    });
  });

  afterAll(async () => {
    await testHelpers.afterAll(context);
  });

  beforeEach(async () => {
    await testHelpers.beforeEach(context);
  });

  afterEach(async () => {
    await testHelpers.afterEach(context);
  });

  it('should debug the email processing pipeline step by step', async () => {
    console.log('🔍 === DEBUGGING EMAIL PROCESSING PIPELINE ===');
    
    // Step 1: Check polling service status
    const pollingStatus = context.mailhogPollingService.getStatus();
    console.log('📧 MailHog Polling Service Status:', pollingStatus);
    expect(pollingStatus.isPolling).toBe(true);
    
    // Step 2: Check services are healthy
    const serviceStatus = await context.getServicesStatus();
    console.log('🏥 Service Health Status:', serviceStatus);
    expect(serviceStatus['workflow-worker']).toBeDefined();
    expect(serviceStatus['workflow-worker'].healthy).toBe(true);
    expect(serviceStatus['mailhog']).toBeDefined();
    expect(serviceStatus['mailhog'].healthy).toBe(true);
    
    // Step 3: Create test data
    console.log('🏗️ Creating test data...');
    const { tenant, company, contact } = await context.emailTestFactory.createBasicEmailScenario();
    console.log('📋 Test data created:', {
      tenant: tenant.tenant,
      company: company.company_name,
      contact: contact.email
    });
    
    // Step 4: Check database state before sending email
    const beforeTickets = await context.db.raw(`
      SELECT COUNT(*) as count FROM tickets
    `);
    console.log('🎫 Tickets before email:', beforeTickets[0].count);
    
    // Step 5: Send email
    console.log('📤 Sending test email...');
    const testEmail = {
      from: contact.email,
      to: 'support@company.com',
      subject: 'Debug Test Email',
      body: 'This is a debug test email to trace the processing pipeline.'
    };
    
    const { sentEmail, capturedEmail } = await context.sendAndCaptureEmail(testEmail);
    console.log('✅ Email sent and captured:', {
      messageId: sentEmail.messageId,
      subject: capturedEmail.Content.Headers.Subject[0]
    });
    
    // Step 6: Wait a bit and check polling service activity
    console.log('⏳ Waiting 5 seconds for polling service to pick up email...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const statusAfterEmail = context.mailhogPollingService.getStatus();
    console.log('📧 Polling service status after email:', statusAfterEmail);
    
    // Step 7: Check if any workflow events were created
    const workflowEvents = await context.db.raw(`
      SELECT * FROM workflow_events 
      WHERE created_at > NOW() - INTERVAL '1 minute'
      ORDER BY created_at DESC
    `);
    console.log('🔄 Recent workflow events:', workflowEvents.length);
    if (workflowEvents.length > 0) {
      console.log('📊 Latest workflow events:', workflowEvents.slice(0, 3));
    }
    
    // Step 8: Check if any tickets were created
    const afterTickets = await context.db.raw(`
      SELECT t.*, c.email as contact_email 
      FROM tickets t 
      LEFT JOIN contacts c ON t.contact_name_id = c.contact_name_id
      WHERE t.created_at > NOW() - INTERVAL '1 minute'
      ORDER BY t.created_at DESC
    `);
    console.log('🎫 Tickets created in last minute:', afterTickets.length);
    if (afterTickets.length > 0) {
      console.log('📋 Recent tickets:', afterTickets);
    }
    
    // Step 9: Check workflow worker health endpoint for more details
    try {
      const response = await fetch('http://localhost:4001/health');
      const healthData = await response.json();
      console.log('🏥 Workflow worker detailed health:', healthData);
    } catch (error) {
      console.log('❌ Failed to get workflow worker health:', error.message);
    }
    
    // Step 10: Check EventBus/Redis streams
    try {
      const { getEventBus } = await import('../../lib/eventBus');
      const eventBus = getEventBus();
      console.log('📡 EventBus instance created successfully');
      
      // Test publishing a simple event
      await eventBus.publish({
        eventType: 'CUSTOM_EVENT',
        payload: {
          tenantId: tenant.tenant,
          userId: 'debug-test',
          eventName: 'debug-test-event'
        }
      });
      console.log('✅ Test event published successfully');
    } catch (error) {
      console.log('❌ EventBus test failed:', error.message);
    }
    
    console.log('🔍 === END DEBUG PIPELINE ===');
    
    // For now, just expect the basic infrastructure to work
    expect(sentEmail).toBeDefined();
    expect(capturedEmail).toBeDefined();
  }, 30000); // 30 second timeout for debugging
});