import { describe, it } from 'vitest';
import { setupE2ETestEnvironment } from '../utils/e2eTestSetup';
import { ApiKeyServiceForApi } from '../../../lib/services/apiKeyServiceForApi';

describe('Debug API Key', () => {
  it('should debug API key creation and validation', async () => {
    console.log('🔍 Starting API key debug...\n');
    
    let env;
    try {
      // Setup test environment
      env = await setupE2ETestEnvironment();
      console.log('✅ Test environment setup complete');
      console.log(`📋 Tenant ID: ${env.tenant}`);
      console.log(`🔑 API Key (plaintext): ${env.apiKey}`);
      console.log(`👤 User ID: ${env.userId}\n`);
      
      // Check what's in the database
      const apiKeyRecord = await env.db('api_keys')
        .where('user_id', env.userId)
        .where('tenant', env.tenant)
        .first();
      
      console.log('📊 API Key record from database:');
      console.log(`  - api_key (hashed): ${apiKeyRecord?.api_key}`);
      console.log(`  - active: ${apiKeyRecord?.active}`);
      console.log(`  - tenant: ${apiKeyRecord?.tenant}`);
      console.log(`  - user_id: ${apiKeyRecord?.user_id}\n`);
      
      // Test validation with tenant ID
      console.log('🧪 Testing API key validation WITH tenant ID...');
      const resultWithTenant = await ApiKeyServiceForApi.validateApiKeyForTenant(
        env.apiKey,
        env.tenant
      );
      console.log(`Result: ${resultWithTenant ? '✅ Valid' : '❌ Invalid'}`);
      if (resultWithTenant) {
        console.log(`  - User ID: ${resultWithTenant.user_id}`);
        console.log(`  - Tenant: ${resultWithTenant.tenant}`);
      }
      
      // Test validation without tenant ID
      console.log('\n🧪 Testing API key validation WITHOUT tenant ID...');
      const resultWithoutTenant = await ApiKeyServiceForApi.validateApiKeyAnyTenant(env.apiKey);
      console.log(`Result: ${resultWithoutTenant ? '✅ Valid' : '❌ Invalid'}`);
      if (resultWithoutTenant) {
        console.log(`  - User ID: ${resultWithoutTenant.user_id}`);
        console.log(`  - Tenant: ${resultWithoutTenant.tenant}`);
      }
      
      // Test hash function
      console.log('\n🔐 Testing hash function...');
      const hashedKey = ApiKeyServiceForApi.hashApiKey(env.apiKey);
      console.log(`Hashed key: ${hashedKey}`);
      console.log(`Matches DB: ${hashedKey === apiKeyRecord?.api_key ? '✅ Yes' : '❌ No'}`);
      
    } finally {
      if (env) {
        await env.cleanup();
        console.log('\n🧹 Cleanup complete');
      }
    }
  });
});