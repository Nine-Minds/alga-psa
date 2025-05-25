#!/usr/bin/env node

/**
 * Simple tool to dump the current UI state from the automation server
 * Usage: node dump-ui-state.js [--json] [--components-only] [--count]
 */

const args = process.argv.slice(2);
const options = {
  json: args.includes('--json'),
  componentsOnly: args.includes('--components-only'),
  count: args.includes('--count'),
  help: args.includes('--help') || args.includes('-h')
};

if (options.help) {
  console.log(`
UI State Dump Tool
==================

Usage: node dump-ui-state.js [options]

Options:
  --json           Output raw JSON response
  --components-only Show only component list (no page info)  
  --count          Show only component count
  --help, -h       Show this help message

Examples:
  node dump-ui-state.js                    # Pretty formatted output
  node dump-ui-state.js --json             # Raw JSON
  node dump-ui-state.js --count            # Just the count
  node dump-ui-state.js --components-only  # Components without page info
`);
  process.exit(0);
}

async function dumpUIState() {
  try {
    console.log('🔍 Fetching UI state from automation server...\n');
    
    const response = await fetch('http://localhost:4000/api/ui-state');
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    
    if (options.count) {
      const componentCount = data.result?.components?.length || 0;
      console.log(`📊 Total components: ${componentCount}`);
      return;
    }
    
    console.log('📄 Page Info:');
    console.log(`   Title: "${data.page?.title || 'Unknown'}"`);
    console.log(`   URL: ${data.page?.url || 'Unknown'}\n`);
    
    if (!data.result || !data.result.components) {
      console.log('❌ No UI state data available\n');
      return;
    }
    
    const { id, title, components } = data.result;
    
    if (!options.componentsOnly) {
      console.log('🎯 UI State Info:');
      console.log(`   State ID: ${id}`);
      console.log(`   State Title: "${title}"`);
      console.log(`   Component Count: ${components.length}\n`);
    }
    
    console.log('🧩 Components:');
    console.log('==============\n');
    
    // Function to print component tree
    function printComponent(component, depth = 0) {
      const indent = '  '.repeat(depth);
      const prefix = depth === 0 ? '📦' : '├─';
      
      console.log(`${indent}${prefix} ${component.id}`);
      console.log(`${indent}   Type: ${component.type}`);
      console.log(`${indent}   Label: "${component.label || 'No label'}"`);
      
      if (component.variant) {
        console.log(`${indent}   Variant: ${component.variant}`);
      }
      
      if (component.actions && component.actions.length > 0) {
        console.log(`${indent}   Actions: [${component.actions.join(', ')}]`);
      }
      
      if (component.visible !== undefined) {
        console.log(`${indent}   Visible: ${component.visible}`);
      }
      
      if (component.helperText) {
        console.log(`${indent}   Helper: "${component.helperText}"`);
      }
      
      console.log('');
      
      // Print children
      if (component.children && component.children.length > 0) {
        component.children.forEach(child => {
          printComponent(child, depth + 1);
        });
      }
    }
    
    // Print all root components
    components.forEach(component => {
      printComponent(component);
    });
    
    console.log(`\n📊 Summary: ${components.length} root component(s) found`);
    
    // Count total components (including nested)
    function countAllComponents(components) {
      let count = 0;
      components.forEach(component => {
        count++;
        if (component.children) {
          count += countAllComponents(component.children);
        }
      });
      return count;
    }
    
    const totalComponents = countAllComponents(components);
    console.log(`📊 Total components (including nested): ${totalComponents}`);
    
  } catch (error) {
    console.error('❌ Failed to fetch UI state:', error.message);
    console.error('\n💡 Make sure the automation server is running on port 4000');
    process.exit(1);
  }
}

// Add fetch polyfill for Node.js
if (typeof fetch === 'undefined') {
  global.fetch = async (url, options) => {
    const { default: fetch } = await import('node-fetch');
    return fetch(url, options);
  };
}

dumpUIState().catch(console.error);