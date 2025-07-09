import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import '../../../test-utils/nextApiMock';
import { createPersistentE2EHelpers, PersistentE2ETestContext } from './utils/persistent-test-context';
import { createEmailTestHelpers, EmailTestHelpers } from './utils/email-test-helpers';

describe('Email Threading - Fix Test', () => {
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

    // Manually apply the email_metadata migration if it doesn't exist
    await ensureEmailMetadataColumn(context);
  }, 25000);

  afterAll(async () => {
    await testHelpers.afterAll(context);
  });

  beforeEach(async () => {
    await testHelpers.beforeEach(context);
  });

  afterEach(async () => {
    await testHelpers.afterEach(context);
  });

  it('should properly thread email replies after applying migration', async () => {
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
    
    // Check if email metadata was stored
    const ticketWithMetadata = await context.db('tickets')
      .where('ticket_id', ticketId)
      .select('email_metadata')
      .first();
    console.log(`📊 Initial ticket email_metadata:`, ticketWithMetadata?.email_metadata);

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
    
    // Log all tickets for debugging
    finalTickets.forEach((ticket, index) => {
      console.log(`🎫 Ticket ${index + 1}: ${ticket.ticket_id} - ${ticket.title}`);
      console.log(`   Email metadata:`, ticket.email_metadata);
    });
    
    // Log comment details for debugging
    comments.forEach((comment, index) => {
      console.log(`💬 Comment ${index + 1}: ${comment.note?.substring(0, 50)}...`);
    });
    
    // The key assertion - should have only 1 ticket (threaded)
    expect(finalTickets).toHaveLength(1);
    expect(finalTickets[0].ticket_id).toBe(initialTickets[0].ticket_id);
    
    // Should have 2 comments on the same ticket
    expect(comments).toHaveLength(2);
    expect(comments[0].note).toContain('This is the initial support request.');
    expect(comments[1].note).toContain('This is a reply to the initial request.');
    
    console.log('✅ Email threading test passed!');
  }, 90000);
});

/**
 * Ensure the email_metadata column exists in the tickets table
 */
async function ensureEmailMetadataColumn(context: PersistentE2ETestContext): Promise<void> {
  try {
    // Check if the column already exists
    const tableInfo = await context.db.raw(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'tickets' 
      AND column_name = 'email_metadata'
    `);
    
    const columns = tableInfo.rows || tableInfo;
    const columnExists = columns.length > 0;
    
    if (columnExists) {
      console.log('✅ email_metadata column already exists');
      return;
    }
    
    console.log('🛠️ Adding email_metadata column to tickets table...');
    
    // Add the column manually
    await context.db.raw(`
      ALTER TABLE tickets 
      ADD COLUMN email_metadata JSONB NULL 
      COMMENT ON COLUMN tickets.email_metadata IS 'Email threading metadata for reply detection'
    `);
    
    console.log('✅ email_metadata column added successfully');
    
  } catch (error) {
    console.error('❌ Error ensuring email_metadata column:', error.message);
    throw error;
  }
}