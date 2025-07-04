import { describe, it, expect } from 'vitest';
import { setupE2ETestEnvironment } from '../utils/e2eTestSetup';
import { createTestContact } from '../utils/contactTestDataFactory';

describe('Single Contact Test', () => {
  it('should create and retrieve a contact', async () => {
    let env;
    try {
      env = await setupE2ETestEnvironment();
      console.log('\n🚀 Test setup complete');
      console.log('API Key:', env.apiKey);
      console.log('Tenant:', env.tenant);
      
      // Test 1: List contacts (should be empty)
      console.log('\n📋 Listing contacts...');
      const listResponse = await env.apiClient.get('/api/v1/contacts');
      console.log('List response:', listResponse.status);
      console.log('Data:', JSON.stringify(listResponse.data, null, 2));
      
      if (listResponse.status !== 200) {
        console.error('❌ Failed to list contacts');
        return;
      }
      
      // Test 2: Create a contact
      console.log('\n➕ Creating contact...');
      const contactData = {
        full_name: 'Test Contact',
        email: 'test@example.com',
        phone: '555-1234',
        company_id: env.companyId
      };
      
      const createResponse = await env.apiClient.post('/api/v1/contacts', contactData);
      console.log('Create response:', createResponse.status);
      console.log('Data:', JSON.stringify(createResponse.data, null, 2));
      
      if (createResponse.status === 201) {
        console.log('✅ Contact created successfully!');
        
        // Test 3: Get the created contact
        const contactId = createResponse.data.data.contact_name_id;
        console.log(`\n🔍 Getting contact ${contactId}...`);
        
        const getResponse = await env.apiClient.get(`/api/v1/contacts/${contactId}`);
        console.log('Get response:', getResponse.status);
        console.log('Data:', JSON.stringify(getResponse.data, null, 2));
      }
      
    } catch (error) {
      console.error('❌ Test error:', error);
    } finally {
      if (env) {
        await env.cleanup();
      }
    }
  });
});