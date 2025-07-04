import { describe, it } from 'vitest';
import { setupE2ETestEnvironment } from '../utils/e2eTestSetup';

describe('Test with real API key', () => {
  it('should test contacts endpoint with real API key', async () => {
    let env;
    try {
      // Setup test environment to get real API key
      env = await setupE2ETestEnvironment();
      console.log('\n🔑 Test API Key:', env.apiKey);
      console.log('📋 Tenant ID:', env.tenant);
      console.log('👤 User ID:', env.userId);
      
      // Make request with real API key
      console.log('\n📡 Making request to /api/v1/contacts...');
      const response = await env.apiClient.get('/api/v1/contacts');
      
      console.log('📊 Response status:', response.status);
      console.log('📊 Response data:', JSON.stringify(response.data, null, 2));
      
    } catch (error) {
      console.error('❌ Error:', error);
    } finally {
      if (env) {
        await env.cleanup();
      }
    }
  });
});