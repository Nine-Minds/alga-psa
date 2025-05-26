#!/usr/bin/env node

/**
 * Test script to verify QuickAddCompany dialog appears in UI state
 * This uses the existing puppeteer infrastructure to test against a running dev server
 */

import puppeteer from 'puppeteer';
import { PuppeteerHelper } from './src/puppeteerHelper.js';
import { getUIState } from './src/tools/getUIState.js';
import { navigateTo } from './src/tools/navigateTo.js';
import { takeScreenshot } from './src/tools/takeScreenshot.js';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_TIMEOUT = 30000;

async function testQuickAddCompanyUIState() {
  console.log('🧪 Testing QuickAddCompany UI State Integration...\n');
  
  const browser = await puppeteer.launch({
    headless: false, // Set to true for CI environments
    devtools: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  const helper = new PuppeteerHelper(page);
  
  try {
    console.log('📍 Step 1: Navigate to application...');
    await navigateTo.execute(page, { url: `${BASE_URL}/msp/companies` });
    await page.waitForTimeout(3000); // Wait for page to load
    
    console.log('📋 Step 2: Get initial UI state (dialog should be closed)...');
    const initialState = await getUIState.execute(page, { 
      jsonpath: '$.components[?(@.id=="quick-add-company-dialog")]' 
    });
    
    console.log('Initial state result:', JSON.stringify(initialState.result, null, 2));
    
    if (initialState.result && !Array.isArray(initialState.result)) {
      console.log('⚠️  Dialog found in closed state - this might indicate it\'s always present');
    } else {
      console.log('✅ Dialog not found in initial state (expected)');
    }
    
    console.log('\n📍 Step 3: Look for "Add Client" or "Quick Add" button...');
    await takeScreenshot.execute(page, { filename: 'before-dialog-open.png' });
    
    // Try different possible selectors for opening the dialog
    const possibleTriggers = [
      'add-client-btn',
      'quick-add-company-btn', 
      'add-company-btn',
      'new-client-btn'
    ];
    
    let triggerFound = false;
    for (const triggerId of possibleTriggers) {
      try {
        console.log(`   Trying trigger: ${triggerId}...`);
        await helper.click(triggerId);
        triggerFound = true;
        console.log(`✅ Successfully clicked: ${triggerId}`);
        break;
      } catch (error) {
        console.log(`   ❌ ${triggerId} not found`);
      }
    }
    
    if (!triggerFound) {
      console.log('⚠️  Could not find dialog trigger button. Trying manual approach...');
      
      // Try to find any button with "Add" in the text
      const addButtons = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons
          .filter(btn => btn.textContent?.toLowerCase().includes('add'))
          .map((btn, index) => ({
            index,
            text: btn.textContent,
            id: btn.id,
            automationId: btn.getAttribute('data-automation-id'),
            classes: btn.className
          }));
      });
      
      console.log('Found Add buttons:', addButtons);
      
      if (addButtons.length > 0) {
        // Try clicking the first "Add" button
        await page.evaluate((index) => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const addButtons = buttons.filter(btn => btn.textContent?.toLowerCase().includes('add'));
          if (addButtons[index]) {
            addButtons[index].click();
          }
        }, 0);
        console.log('✅ Clicked first "Add" button');
      }
    }
    
    console.log('\n📍 Step 4: Wait for dialog to appear...');
    await page.waitForTimeout(2000); // Wait for dialog animation
    
    console.log('📋 Step 5: Get UI state with dialog open...');
    const dialogOpenState = await getUIState.execute(page, { 
      jsonpath: '$.components[?(@.id=="quick-add-company-dialog")]' 
    });
    
    console.log('Dialog open state result:', JSON.stringify(dialogOpenState.result, null, 2));
    
    console.log('\n📋 Step 6: Get full UI state to see all components...');
    const fullState = await getUIState.execute(page, { jsonpath: '$.components[*]' });
    
    if (Array.isArray(fullState.result)) {
      console.log(`Found ${fullState.result.length} total components:`);
      fullState.result.forEach((component, index) => {
        console.log(`  ${index + 1}. ${component.id} (${component.type}) - ${component.label || 'no label'}`);
      });
      
      // Look for any dialog-related components
      const dialogComponents = fullState.result.filter(c => 
        c.id?.includes('dialog') || 
        c.id?.includes('quick-add') || 
        c.type === 'dialog'
      );
      
      if (dialogComponents.length > 0) {
        console.log('\n🎯 Found dialog-related components:');
        dialogComponents.forEach(comp => {
          console.log(`   ✅ ${comp.id} (${comp.type}):`, comp);
        });
      } else {
        console.log('\n❌ No dialog components found in UI state');
      }
    }
    
    console.log('\n📸 Step 7: Take screenshot of dialog state...');
    await takeScreenshot.execute(page, { filename: 'dialog-open-state.png' });
    
    console.log('\n📋 Step 8: Check DOM for dialog element...');
    const dialogInDOM = await page.evaluate(() => {
      const dialogElement = document.querySelector('[data-automation-id="quick-add-company-dialog"]');
      if (dialogElement) {
        return {
          found: true,
          id: dialogElement.id,
          automationId: dialogElement.getAttribute('data-automation-id'),
          visible: dialogElement.offsetParent !== null,
          innerHTML: dialogElement.innerHTML.substring(0, 200) + '...'
        };
      }
      
      // Also check for dialog by ID
      const dialogById = document.getElementById('quick-add-company-dialog');
      if (dialogById) {
        return {
          found: true,
          foundBy: 'id',
          id: dialogById.id,
          automationId: dialogById.getAttribute('data-automation-id'),
          visible: dialogById.offsetParent !== null,
          innerHTML: dialogById.innerHTML.substring(0, 200) + '...'
        };
      }
      
      return { found: false };
    });
    
    console.log('Dialog DOM check:', dialogInDOM);
    
    console.log('\n🔍 Step 9: Check for ReflectionContainer...');
    const reflectionContainer = await page.evaluate(() => {
      const container = document.querySelector('[data-automation-id="quick-add-company-form"]') ||
                       document.getElementById('quick-add-company-form');
      
      if (container) {
        return {
          found: true,
          id: container.id,
          automationId: container.getAttribute('data-automation-id'),
          tagName: container.tagName,
          classes: container.className
        };
      }
      
      return { found: false };
    });
    
    console.log('ReflectionContainer check:', reflectionContainer);
    
    // Final assessment
    console.log('\n📊 Test Results Summary:');
    console.log('='*50);
    
    if (dialogOpenState.result && !dialogOpenState.result.message) {
      console.log('✅ SUCCESS: QuickAddCompany dialog found in UI state!');
      console.log('   The UI reflection integration is working correctly.');
    } else {
      console.log('❌ FAILURE: QuickAddCompany dialog NOT found in UI state');
      console.log('   Possible issues:');
      console.log('   1. Dialog is not actually open');
      console.log('   2. UI reflection system is not connected');
      console.log('   3. useAutomationIdAndRegister is not working');
      console.log('   4. WebSocket connection for UI state is broken');
    }
    
    if (dialogInDOM.found) {
      console.log('✅ Dialog element exists in DOM');
    } else {
      console.log('❌ Dialog element NOT found in DOM');
    }
    
    if (reflectionContainer.found) {
      console.log('✅ ReflectionContainer found in DOM');
    } else {
      console.log('❌ ReflectionContainer NOT found in DOM');
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
  } finally {
    console.log('\n🧹 Cleaning up...');
    await browser.close();
  }
}

// Run the test
if (process.argv[1].endsWith('test-quick-add-company-ui-state.js')) {
  testQuickAddCompanyUIState().catch(console.error);
}

export { testQuickAddCompanyUIState };