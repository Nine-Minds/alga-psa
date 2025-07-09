import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import '../../../test-utils/nextApiMock';
import { createPersistentE2EHelpers, PersistentE2ETestContext } from './utils/persistent-test-context';
import { createEmailTestHelpers, EmailTestHelpers } from './utils/email-test-helpers';

describe('Email Threading - Isolated Test', () => {
  const testHelpers = createPersistentE2EHelpers();
  let context: PersistentE2ETestContext;
  let emailHelpers: EmailTestHelpers;

  beforeAll(async () => {
    context = await testHelpers.beforeAll({
      runSeeds: true,
      testMode: 'e2e',
      clearEmailsBeforeTest: true
    });
    emailHelpers = createEmailTestHelpers(context);
  }, 15000);

  afterAll(async () => {
    await testHelpers.afterAll(context);
  });

  beforeEach(async () => {
    await testHelpers.beforeEach(context);
  });

  afterEach(async () => {
    await testHelpers.afterEach(context);
  });

  it('should properly thread email replies', async () => {
    // Arrange
    const scenario = await emailHelpers.createEmailScenario();
    
    // Act - Send initial email
    console.log('📧 Sending initial email...');
    const { sentEmail } = await scenario.sendEmail({
      subject: 'Initial Support Request',
      body: 'This is the initial support request.'
    });
    
    console.log('⏳ Waiting for initial email processing...');
    await scenario.waitForProcessing();
    
    console.log('🔍 Getting initial tickets...');
    const initialTickets = await scenario.getTickets();
    console.log(`📊 Found ${initialTickets.length} initial tickets`);
    
    expect(initialTickets).toHaveLength(1);
    const ticketId = initialTickets[0].ticket_id;
    console.log(`🎫 Initial ticket created with ID: ${ticketId}`);

    // Send reply email
    console.log('📧 Sending reply email...');
    await scenario.sendEmail({
      subject: 'Re: Initial Support Request',
      body: 'This is a reply to the initial request.',
      inReplyTo: sentEmail.messageId,
      references: sentEmail.messageId
    });
    
    console.log('⏳ Waiting for reply email processing...');
    await scenario.waitForProcessing();

    // Assert - Verify threading
    console.log('🔍 Getting final tickets...');
    const finalTickets = await scenario.getTickets();
    console.log(`📊 Found ${finalTickets.length} final tickets`);
    
    console.log('🔍 Getting comments...');
    const comments = await scenario.getComments(ticketId);
    console.log(`💬 Found ${comments.length} comments`);
    
    // Log comment details for debugging
    comments.forEach((comment, index) => {
      console.log(`💬 Comment ${index + 1}: ${comment.note?.substring(0, 50)}...`);
    });
    
    // Basic assertions first
    expect(finalTickets).toHaveLength(1);
    expect(finalTickets[0].ticket_id).toBe(initialTickets[0].ticket_id);
    
    // Comment assertions
    expect(comments).toHaveLength(2);
    expect(comments[0].note).toContain('This is the initial support request.');
    expect(comments[1].note).toContain('This is a reply to the initial request.');
    
    console.log('✅ Email threading test passed!');
  }, 60000);
});