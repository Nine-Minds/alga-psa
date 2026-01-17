#!/usr/bin/env node

// Test script to verify module resolution using relative paths
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packages = [
  'product-settings-extensions',
  'product-extensions',
  'product-chat',
  'product-workflows',
  'product-billing',
  'product-extension-actions',
  'product-auth-ee',
  'product-extension-initialization'
];

console.log('Testing module resolution with relative paths...\n');

async function testPackage(packageName) {
  try {
    // Test the index.js import using relative path
    const packagePath = join(__dirname, 'packages', packageName, 'index.js');
    console.log(`Testing: ${packageName} (${packagePath})`);

    // Use dynamic import with file:// protocol
    const module = await import(`file://${packagePath}`);
    console.log(`✅ ${packageName} - resolved successfully`);
    console.log(`   Exports: ${Object.keys(module).join(', ') || 'default only'}`);

    return true;
  } catch (error) {
    console.error(`❌ ${packageName} - failed to resolve`);
    console.error(`   Error: ${error.message}`);
    return false;
  }
}

// Test all packages
let successCount = 0;
for (const pkg of packages) {
  try {
    const success = await testPackage(pkg);
    if (success) successCount++;
  } catch (error) {
    console.error(`❌ ${pkg} - failed with error: ${error.message}`);
  }
  console.log(''); // blank line
}

console.log(`\nResults: ${successCount}/${packages.length} packages resolved successfully`);

if (successCount === packages.length) {
  console.log('🎉 All package entry points are working correctly!');
  process.exit(0);
} else {
  console.log('❌ Some packages failed to resolve. Check the errors above.');
  process.exit(1);
}
