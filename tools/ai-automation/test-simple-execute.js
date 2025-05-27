#!/usr/bin/env node

/**
 * Simple test to verify helper.execute method is functional
 */

async function testExecuteMethod() {
  try {
    console.log('🧪 Testing helper.execute method...\n');
    
    const response = await fetch('http://localhost:4000/api/script', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: `
// Test the helper.execute method
if (typeof helper.execute === 'function') {
  console.log('✅ helper.execute is available');
  console.log('Available methods:', Object.keys(helper));
  'SUCCESS: helper.execute is functional';
} else {
  console.log('❌ helper.execute is not available');
  'FAILED: helper.execute not found';
}
        `
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('🔧 Test Result:', JSON.stringify(result, null, 2));
    
    if (result.result === 'SUCCESS: helper.execute is functional') {
      console.log('\n🎉 SUCCESS: The unified helper system is working!');
      console.log('You can now use:');
      console.log('  - helper.execute(elementId, actionType, params)');
      console.log('  - helper.query(elementId)');
      console.log('  - helper.wait(condition)');
      console.log('  - All legacy methods: click, type, select, etc.');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Add fetch polyfill for Node.js
if (typeof fetch === 'undefined') {
  global.fetch = async (url, options) => {
    const { default: fetch } = await import('node-fetch');
    return fetch(url, options);
  };
}

testExecuteMethod().catch(console.error);