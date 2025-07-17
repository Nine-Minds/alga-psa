#!/usr/bin/env node

/**
 * Test script for Gmail webhook validation
 * Usage: node scripts/test-webhook.js [email] [subscription]
 */

import { 
  runWebhookTestSuite, 
  generateTestPubSubNames,
  createTestWebhookPayload,
  testWebhookEndpoint 
} from '../src/lib/testing/webhook-validator.js';

async function main() {
  const args = process.argv.slice(2);
  const email = args[0] || 'test@example.com';
  const subscriptionName = args[1] || 'gmail-webhook-test-tenant';
  
  // Get webhook URL from environment or use default
  const webhookUrl = process.env.NGROK_URL 
    ? `${process.env.NGROK_URL}/api/email/webhooks/google`
    : 'http://localhost:3000/api/email/webhooks/google';
  
  console.log('🧪 Starting Gmail webhook test suite...');
  console.log(`📧 Email: ${email}`);
  console.log(`🔔 Subscription: ${subscriptionName}`);
  console.log(`🌐 Webhook URL: ${webhookUrl}`);
  console.log('');
  
  try {
    const results = await runWebhookTestSuite(webhookUrl, email, subscriptionName);
    
    console.log('📊 Test Results:');
    console.log('================');
    
    Object.entries(results.tests).forEach(([testName, result]) => {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} ${testName}`);
      
      if (!result.success && result.error) {
        console.log(`   Error: ${result.error}`);
      }
      
      if (result.details) {
        console.log(`   Details: ${JSON.stringify(result.details, null, 2)}`);
      }
      console.log('');
    });
    
    console.log('🎯 Overall Result:', results.overallSuccess ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED');
    
    // Quick connectivity test
    console.log('');
    console.log('🚀 Testing live webhook delivery...');
    const testPayload = createTestWebhookPayload(email, 'live-test-123', subscriptionName);
    const connectivityResult = await testWebhookEndpoint(webhookUrl, testPayload);
    
    if (connectivityResult.success) {
      console.log('✅ Webhook endpoint is reachable and responding');
      console.log(`   Response: ${JSON.stringify(connectivityResult.details?.response, null, 2)}`);
    } else {
      console.log('❌ Webhook endpoint test failed');
      console.log(`   Error: ${connectivityResult.error}`);
    }
    
  } catch (error) {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  }
}

// Helper function to test individual components
async function testComponent(component) {
  switch (component) {
    case 'payload':
      const payload = createTestWebhookPayload('test@example.com', 'test-123', 'test-subscription');
      console.log('📦 Test payload:');
      console.log(JSON.stringify(payload, null, 2));
      break;
      
    case 'names':
      const names = generateTestPubSubNames('test-tenant');
      console.log('🏷️  Test Pub/Sub names:');
      console.log(JSON.stringify(names, null, 2));
      break;
      
    default:
      console.log('Usage: node scripts/test-webhook.js [email] [subscription]');
      console.log('   or: node scripts/test-webhook.js --component [payload|names]');
  }
}

// Check for component testing
if (process.argv[2] === '--component') {
  testComponent(process.argv[3]);
} else {
  main();
}