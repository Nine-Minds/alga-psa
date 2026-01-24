#!/usr/bin/env node

// Test script to verify module resolution for all product packages
// This should be run from the project root

const packages = [
  '@product/settings-extensions',
  '@product/extensions',
  '@product/chat',
  '@product/workflows',
  '@product/billing',
  '@product/extension-actions',
  '@product/auth-ee',
  '@product/extension-initialization'
];

console.log('Testing module resolution for all packages...\n');

async function testPackage(packageName) {
  try {
    // Test the /entry import
    const entryPath = `${packageName}/entry`;
    console.log(`Testing: ${entryPath}`);

    // Use dynamic import to test resolution
    const module = await import(entryPath);
    console.log(`✅ ${entryPath} - resolved successfully`);
    console.log(`   Exports: ${Object.keys(module).join(', ') || 'default only'}`);

    return true;
  } catch (error) {
    console.error(`❌ ${packageName}/entry - failed to resolve`);
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
