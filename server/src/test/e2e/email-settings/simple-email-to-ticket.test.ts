import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { getConnection } from '@alga-psa/db/connection';
import { getEventBus } from '../../../lib/eventBus';
import type { Knex } from 'knex';

describe('Simple Email to Ticket Test', () => {
  let db: Knex;
  let tenantId: string;
  let providerId: string;
  let defaultsId: string;

  beforeAll(async () => {
    console.log('🚀 Setting up simple email test...');
    
    // Get database connection
    db = await getConnection();
    
    // Create test data
    tenantId = uuidv4();
    providerId = uuidv4();
    defaultsId = uuidv4();
    
    // Create tenant
    await db('tenants').insert({
      tenant: tenantId,
      name: 'Test Tenant',
      slug: 'test-tenant',
      created_at: new Date(),
      updated_at: new Date()
    });
    
    // Create basic required data
    const boardId = uuidv4();
    const statusId = uuidv4();
    const priorityId = uuidv4();
    
    await db('boards').insert({
      board_id: boardId,
      tenant: tenantId,
      name: 'Email',
      is_default: true
    });
    
    await db('statuses').insert({
      status_id: statusId,
      tenant: tenantId,
      name: 'Open',
      is_default: true,
      status_type: 'open'
    });
    
    await db('priorities').insert({
      priority_id: priorityId,
      tenant: tenantId,
      name: 'Normal',
      is_default: true,
      sort_order: 50
    });
    
    // Create inbound ticket defaults
    await db('inbound_ticket_defaults').insert({
      id: defaultsId,
      tenant: tenantId,
      short_name: 'test-defaults',
      display_name: 'Test Defaults',
      defaults: JSON.stringify({
        board_id: boardId,
        status_id: statusId,
        priority_id: priorityId,
        entered_by: null
      }),
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    });
    
    // Create email provider
    await db('email_providers').insert({
      id: providerId,
      tenant: tenantId,
      provider_name: 'Test Provider',
      provider_type: 'test',
      mailbox: 'test@example.com',
      is_active: true,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date()
    });
    
    console.log('✅ Test data created');
  });
  
  afterAll(async () => {
    console.log('🧹 Cleaning up test data...');
    
    // Clean up in reverse order
    await db('tickets').where('tenant', tenantId).delete();
    await db('email_providers').where('id', providerId).delete();
    await db('inbound_ticket_defaults').where('id', defaultsId).delete();
    await db('priorities').where('tenant', tenantId).delete();
    await db('statuses').where('tenant', tenantId).delete();
    await db('boards').where('tenant', tenantId).delete();
    await db('tenants').where('tenant', tenantId).delete();
    
    await db.destroy();
    console.log('✅ Cleanup complete');
  });
  
  it('should create ticket from email event', async () => {
    console.log('📧 Testing email to ticket creation...');
    
    // Emit an INBOUND_EMAIL_RECEIVED event
    const eventBus = getEventBus();
    
    const emailData = {
      id: 'test-email-' + Date.now(),
      subject: 'Test Email Subject',
      from: { email: 'sender@example.com', name: 'Test Sender' },
      to: [{ email: 'test@example.com' }],
      body: { text: 'This is a test email body' },
      receivedAt: new Date().toISOString(),
      attachments: [],
      provider: 'test',
      providerId: providerId,
      tenant: tenantId
    };
    
    console.log('📤 Publishing INBOUND_EMAIL_RECEIVED event...');
    await eventBus.publish({
      eventType: 'INBOUND_EMAIL_RECEIVED',
      payload: {
        tenantId: tenantId,
        providerId: providerId,
        emailData: emailData
      }
    });
    
    // Wait for workflow to process
    console.log('⏳ Waiting for workflow processing...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check if ticket was created
    console.log('🔍 Checking for created ticket...');
    const ticket = await db('tickets')
      .where('tenant', tenantId)
      .where('title', 'Test Email Subject')
      .first();
    
    if (ticket) {
      console.log('✅ Ticket created successfully!');
      console.log(`   ID: ${ticket.ticket_id}`);
      console.log(`   Title: ${ticket.title}`);
      console.log(`   Board: ${ticket.board_id}`);
      console.log(`   Status: ${ticket.status_id}`);
      console.log(`   Priority: ${ticket.priority_id}`);
      console.log(`   Entered By: ${ticket.entered_by || 'System (null)'}`);
      
      expect(ticket).toBeDefined();
      expect(ticket.title).toBe('Test Email Subject');
      expect(ticket.entered_by).toBeNull(); // System-generated
    } else {
      console.log('❌ No ticket found - workflow may not have processed yet');
      
      // Check workflow executions
      const executions = await db('workflow_executions')
        .where('tenant_id', tenantId)
        .select('execution_id', 'status', 'error_message');
      
      console.log(`Found ${executions.length} workflow executions`);
      executions.forEach(exec => {
        console.log(`  - ${exec.execution_id}: ${exec.status} ${exec.error_message || ''}`);
      });
      
      throw new Error('Ticket was not created from email');
    }
  });
});
