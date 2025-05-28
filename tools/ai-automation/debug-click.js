#!/usr/bin/env node

/**
 * Debug the click action to see what's happening
 */

async function debugClick() {
  try {
    console.log('🔍 Debugging click action...\n');
    
    // First, let's see what actions are available for menu-clients
    console.log('1. Checking available actions for menu-clients:');
    const queryResponse = await fetch('http://localhost:4000/api/script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `
const result = await helper.query('menu-clients');
console.log('Query result for menu-clients:', JSON.stringify(result, null, 2));
result;
        `
      })
    });
    
    const queryResult = await queryResponse.json();
    console.log('Query result:', queryResult);
    
    // Now let's try a direct click using the legacy method
    console.log('\n2. Testing legacy click method:');
    const legacyResponse = await fetch('http://localhost:4000/api/script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `
try {
  console.log('Attempting legacy click...');
  await helper.click('menu-clients');
  console.log('Legacy click completed');
  'LEGACY_SUCCESS';
} catch (error) {
  console.log('Legacy click failed:', error.message);
  'LEGACY_FAILED: ' + error.message;
}
        `
      })
    });
    
    const legacyResult = await legacyResponse.json();
    console.log('Legacy click result:', legacyResult);
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  }
}

// Add fetch polyfill for Node.js
if (typeof fetch === 'undefined') {
  global.fetch = async (url, options) => {
    const { default: fetch } = await import('node-fetch');
    return fetch(url, options);
  };
}

debugClick().catch(console.error);