#!/usr/bin/env node

/**
 * Test script to verify the unified helper is working
 */

async function testUnifiedHelper() {
  try {
    console.log('🧪 Testing unified helper system...\n');
    
    const response = await fetch('http://localhost:4000/api/script', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: `
console.log('🧪 Helper test starting...');
console.log('Helper object:', typeof helper);
if (helper) {
  console.log('Available helper methods:', Object.keys(helper));
  
  // Test if execute method is available
  if (typeof helper.execute === 'function') {
    console.log('✅ helper.execute is available');
    return { success: true, methods: Object.keys(helper) };
  } else {
    console.log('❌ helper.execute is NOT available');
    return { success: false, methods: Object.keys(helper) };
  }
} else {
  console.log('❌ helper object is not defined');
  return { success: false, error: 'helper not defined' };
}
        `
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('🔧 Test Result:', JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('\n💡 Make sure the automation server is running on port 4000');
  }
}

// Add fetch polyfill for Node.js
if (typeof fetch === 'undefined') {
  global.fetch = async (url, options) => {
    const { default: fetch } = await import('node-fetch');
    return fetch(url, options);
  };
}

testUnifiedHelper().catch(console.error);