#!/usr/bin/env node

/**
 * Debug script to check if we have module instance issues
 */

async function debugModuleInstances() {
  console.log('🔍 Debugging Module Instances...\n');
  
  // Test static import
  console.log('1️⃣ Testing static import...');
  const staticImport = await import('./src/uiStateManager.js');
  console.log('Static import uiStateManager:', typeof staticImport.uiStateManager);
  
  // Test dynamic import (same as getUIState now uses)
  console.log('\n2️⃣ Testing dynamic import...');
  const dynamicImport = await import('./src/uiStateManager.js');
  console.log('Dynamic import uiStateManager:', typeof dynamicImport.uiStateManager);
  
  // Check if they're the same instance
  console.log('\n3️⃣ Instance comparison...');
  console.log('Are they the same instance?', staticImport.uiStateManager === dynamicImport.uiStateManager);
  
  // Test state storage
  console.log('\n4️⃣ Testing state storage...');
  const testState = {
    id: 'test-page',
    title: 'Test Title',
    components: [
      { id: 'test-component', type: 'button', label: 'Test Button' }
    ]
  };
  
  console.log('Storing test state in static import...');
  staticImport.uiStateManager.updateState(testState);
  
  console.log('Reading from static import...');
  const staticState = staticImport.uiStateManager.getCurrentState();
  console.log('Static read result:', staticState ? {
    id: staticState.id,
    componentCount: staticState.components?.length || 0
  } : null);
  
  console.log('Reading from dynamic import...');
  const dynamicState = dynamicImport.uiStateManager.getCurrentState();
  console.log('Dynamic read result:', dynamicState ? {
    id: dynamicState.id,
    componentCount: dynamicState.components?.length || 0
  } : null);
  
  console.log('\n📊 Diagnosis:');
  if (staticImport.uiStateManager === dynamicImport.uiStateManager) {
    console.log('✅ Module instances are the same - no instance issue');
  } else {
    console.log('❌ Module instances are different - this is the problem!');
  }
}

debugModuleInstances().catch(console.error);