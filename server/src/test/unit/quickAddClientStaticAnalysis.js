/**
 * Static analysis tool to validate QuickAddClient UI reflection integration
 * This runs without requiring DOM or complex test environment setup
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const QUICK_ADD_CLIENT_PATH = path.join(__dirname, '../../components/clients/QuickAddClient.tsx');

function analyzeQuickAddClientUIReflection() {
  console.log('📋 Analyzing QuickAddClient UI Reflection Integration...\n');
  
  const fileContent = fs.readFileSync(QUICK_ADD_CLIENT_PATH, 'utf8');
  
  const checks = [
    {
      name: 'useAutomationIdAndRegister import',
      test: () => fileContent.includes("import { useAutomationIdAndRegister }"),
      required: true
    },
    {
      name: 'ReflectionContainer import',
      test: () => fileContent.includes("import { ReflectionContainer }"),
      required: true
    },
    {
      name: 'DialogComponent type import',
      test: () => fileContent.includes("import { DialogComponent }"),
      required: true
    },
    {
      name: 'useAutomationIdAndRegister hook usage',
      test: () => fileContent.includes("useAutomationIdAndRegister<DialogComponent>"),
      required: true
    },
    {
      name: 'Dialog registration with ID',
      test: () => fileContent.includes("id: 'quick-add-client-dialog'"),
      required: true
    },
    {
      name: 'Dialog type specified',
      test: () => fileContent.includes("type: 'dialog'"),
      required: true
    },
    {
      name: 'ReflectionContainer wrapper',
      test: () => fileContent.includes("<ReflectionContainer") && fileContent.includes("quick-add-client-form"),
      required: true
    },
    {
      name: 'Automation ID props spread',
      test: () => fileContent.includes("{...dialogProps}"),
      required: true
    },
    {
      name: 'Error state tracking',
      test: () => fileContent.includes("const [error, setError]"),
      required: true
    },
    {
      name: 'Metadata update effect',
      test: () => fileContent.includes("useEffect") && fileContent.includes("updateMetadata"),
      required: true
    },
    {
      name: 'Helper text error mapping',
      test: () => fileContent.includes("helperText: error"),
      required: true
    },
    {
      name: 'Form element IDs present',
      test: () => {
        const requiredIds = [
          'client_name',
          'client_type_select', 
          'email',
          'phone_no',
          'create-client-btn',
          'cancel-quick-add-client-btn'
        ];
        return requiredIds.every(id => fileContent.includes(`id="${id}"`));
      },
      required: true
    }
  ];

  let passedCount = 0;
  let failedCount = 0;
  
  checks.forEach(check => {
    const passed = check.test();
    const status = passed ? '✅' : (check.required ? '❌' : '⚠️');
    
    console.log(`${status} ${check.name}`);
    
    if (passed) {
      passedCount++;
    } else {
      failedCount++;
      if (check.required) {
        console.log(`   ❌ Required check failed!`);
      }
    }
  });

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Passed: ${passedCount}/${checks.length}`);
  console.log(`   ❌ Failed: ${failedCount}/${checks.length}`);
  
  if (failedCount === 0) {
    console.log(`\n🎉 All UI reflection integration checks passed!`);
    console.log(`   The QuickAddClient dialog should now be visible in UI state.`);
  } else {
    console.log(`\n⚠️  Some checks failed. UI reflection may not work properly.`);
  }

  // Additional debugging info
  console.log(`\n🔍 Debugging Info:`);
  console.log(`   File path: ${QUICK_ADD_CLIENT_PATH}`);
  console.log(`   File size: ${fileContent.length} characters`);
  
  // Extract and show the useAutomationIdAndRegister usage
  const automationIdMatch = fileContent.match(/useAutomationIdAndRegister[^}]+}/s);
  if (automationIdMatch) {
    console.log(`\n📋 useAutomationIdAndRegister configuration:`);
    console.log(automationIdMatch[0]);
  }

  return {
    passed: failedCount === 0,
    passedCount,
    failedCount,
    totalChecks: checks.length
  };
}

// Run the analysis
analyzeQuickAddClientUIReflection();

export { analyzeQuickAddClientUIReflection };