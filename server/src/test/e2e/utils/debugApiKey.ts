/**
 * Debug script to test API key creation and validation
 */

import { setupE2ETestEnvironment } from './e2eTestSetup';
import { ApiKeyServiceForApi } from '../../lib/services/apiKeyServiceForApi';
import { tenantDb } from '@alga-psa/db';

async function debugApiKey() {
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
    const apiKeyRecord = await tenantDb(env.db, env.tenant).table('api_keys')
      .where('user_id', env.userId)
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
    
    // Test with wrong tenant
    console.log('\n🧪 Testing API key validation with WRONG tenant ID...');
    const wrongTenantId = '22222222-2222-2222-2222-222222222222';
    const resultWrongTenant = await ApiKeyServiceForApi.validateApiKeyForTenant(
      env.apiKey,
      wrongTenantId
    );
    console.log(`Result: ${resultWrongTenant ? '✅ Valid' : '❌ Invalid (expected)'}`);
    
    // Test hash function
    console.log('\n🔐 Testing hash function...');
    const hashedKey = ApiKeyServiceForApi.hashApiKey(env.apiKey);
    console.log(`Hashed key: ${hashedKey}`);
    console.log(`Matches DB: ${hashedKey === apiKeyRecord?.api_key ? '✅ Yes' : '❌ No'}`);
    
  } catch (error) {
    console.error('❌ Error during debug:', error);
  } finally {
    if (env) {
      await env.cleanup();
      console.log('\n🧹 Cleanup complete');
    }
  }
}

// Run the debug script
debugApiKey().catch(console.error);
