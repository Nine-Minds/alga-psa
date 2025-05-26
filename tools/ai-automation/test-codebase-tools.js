// Simple test script to verify codebase navigation tools
const fetch = require('node-fetch');

const API_BASE = 'http://localhost:4000/api';

async function testTool(toolName, args) {
  console.log(`\n=== Testing ${toolName} ===`);
  console.log('Args:', JSON.stringify(args, null, 2));
  
  try {
    const response = await fetch(`${API_BASE}/tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ toolName, args })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Error:', error);
      return;
    }

    const result = await response.json();
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

async function runTests() {
  console.log('Testing codebase navigation tools...');
  
  // Test list_directory
  await testTool('list_directory', {
    directory: 'server/src/components',
    recursive: false
  });

  // Test search_automation_ids
  await testTool('search_automation_ids', {
    searchTerm: 'button',
    maxResults: 5
  });

  // Test find_files
  await testTool('find_files', {
    name: '*Button*',
    directory: 'server/src',
    type: 'f',
    extension: 'tsx',
    maxResults: 5
  });

  // Test grep_files
  await testTool('grep_files', {
    pattern: 'data-automation-id',
    directory: 'server/src/components',
    filePattern: '*.tsx',
    maxResults: 5
  });
}

if (require.main === module) {
  runTests().then(() => {
    console.log('\nAll tests completed');
    process.exit(0);
  }).catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = { testTool };