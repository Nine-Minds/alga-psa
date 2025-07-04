/**
 * Minimal Ticket API test to verify basic functionality
 */

import { describe, it, expect } from 'vitest';
import { withTestSetup } from '../fixtures/test-setup';

const API_BASE_URL = 'http://127.0.0.1:3000/api/v1';

describe('Ticket API - Minimal Test', () => {
  it('should create and list tickets', async () => {
    // Setup test environment
    const setup = await withTestSetup();
    
    // First, create a company for the ticket
    const companyResponse = await fetch(`${API_BASE_URL}/companies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': setup.apiKey,
        'x-tenant-id': setup.tenantId
      },
      body: JSON.stringify({
        company_name: 'Test Company for Ticket',
        email: 'ticket-test@example.com',
        billing_cycle: 'monthly'
      })
    });
    
    const companyResult = await companyResponse.json();
    const companyId = companyResult.data?.company_id || companyResult.company_id;
    
    // Get default channel ID from test setup (created in withTestSetup)
    const { runWithTenant } = await import('../../../lib/db');
    
    let channelId, statusId, priorityId;
    
    await runWithTenant(setup.tenantId, async () => {
      const db = await import('../../../lib/db/db').then(m => m.getConnection());
      
      const channel = await db('channels')
        .where({ tenant: setup.tenantId })
        .first();
      channelId = channel?.channel_id;
      
      // Get default status and priority
      const newStatus = await db('statuses')
        .where({ tenant: setup.tenantId, name: 'New', status_type: 'ticket' })
        .first();
      statusId = newStatus?.status_id;
      
      const lowPriority = await db('priorities')
        .where({ tenant: setup.tenantId })
        .first();
      priorityId = lowPriority?.priority_id;
      
      console.log('Found channel:', channel);
      console.log('Found status:', newStatus);
      console.log('Found priority:', lowPriority);
    });
    
    console.log('IDs:', { channelId, statusId, priorityId, companyId });
    
    // Test creating a ticket with required fields
    const createResponse = await fetch(`${API_BASE_URL}/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': setup.apiKey,
        'x-tenant-id': setup.tenantId
      },
      body: JSON.stringify({
        title: 'Test Ticket',
        channel_id: channelId,
        company_id: companyId,
        status_id: statusId,
        priority_id: priorityId
      })
    });
    
    console.log('Create ticket response:', createResponse.status);
    if (!createResponse.ok) {
      const error = await createResponse.text();
      console.log('Create ticket error:', error);
    }
    
    expect(createResponse.status).toBe(201);
    const createResult = await createResponse.json();
    console.log('Create result:', JSON.stringify(createResult, null, 2));
    
    // Test listing tickets
    const listResponse = await fetch(`${API_BASE_URL}/tickets`, {
      method: 'GET',
      headers: {
        'x-api-key': setup.apiKey,
        'x-tenant-id': setup.tenantId
      }
    });
    
    console.log('List tickets response:', listResponse.status);
    expect(listResponse.status).toBe(200);
    const listResult = await listResponse.json();
    console.log('List result:', JSON.stringify(listResult, null, 2));
    
    // Should have at least the ticket we created
    expect(listResult.data.length).toBeGreaterThanOrEqual(1);
    
    // Check if we created the ticket successfully
    if (createResult.data) {
      expect(createResult.data.title).toBe('Test Ticket');
    }
  });
});