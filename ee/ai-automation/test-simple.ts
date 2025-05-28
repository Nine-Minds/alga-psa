#!/usr/bin/env node

console.log('Starting simple test...');

try {
  console.log('✅ Simple test completed');
  process.exit(0);
} catch (error) {
  console.error('❌ Test failed:', error);
  process.exit(1);
}