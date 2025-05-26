#!/usr/bin/env node

/**
 * Simple test to check if automation server is receiving and storing UI state
 */

const fetch = require('node:fetch');

async function testAutomationServer() {
  console.log('🔍 Testing Automation Server UI State...\n');
  
  try {
    console.log('📍 Step 1: Check if automation server is running...');
    const healthResponse = await fetch('http://localhost:4000/');
    const healthText = await healthResponse.text();
    console.log('✅ Server response:', healthText);
    
    console.log('\n📍 Step 2: Check UI state endpoint...');
    const stateResponse = await fetch('http://localhost:4000/api/ui-state');
    const stateData = await stateResponse.json();
    
    console.log('📋 UI State Response:');
    console.log(JSON.stringify(stateData, null, 2));
    
    if (stateData.result && stateData.result.error) {
      console.log('\n❌ UI State Error:', stateData.result.message);
    } else if (stateData.result && Array.isArray(stateData.result)) {
      console.log(`\n✅ Found ${stateData.result.length} components in UI state`);
      if (stateData.result.length > 0) {
        console.log('First few components:');
        stateData.result.slice(0, 5).forEach((c, i) => {
          console.log(`   ${i + 1}. ${c.id} (${c.type})`);
        });
      }
    } else {
      console.log('\n⚠️ Unexpected response format');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('\nTroubleshooting:');
    console.log('1. Make sure the automation server is running on port 4000');
    console.log('2. Check if the server started successfully');
    console.log('3. Restart the automation server to pick up code changes');
  }
}

testAutomationServer();