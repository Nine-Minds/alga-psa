#!/usr/bin/env node

/**
 * Simplified UI state test for QuickAddCompany
 * This runs a quick test without complex browser automation
 */

console.log('🧪 Testing QuickAddCompany UI State Integration (Simplified)...\n');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function testQuickAddCompanySimple() {
  try {
    // Import puppeteer dynamically to catch import errors
    console.log('📦 Importing dependencies...');
    const puppeteer = await import('puppeteer');
    console.log('✅ Puppeteer imported successfully');

    // Try to import our tools
    const { PuppeteerHelper } = await import('./src/puppeteerHelper.js');
    const { getUIState } = await import('./src/tools/getUIState.js');
    const { navigateTo } = await import('./src/tools/navigateTo.js');
    console.log('✅ All tools imported successfully');

    console.log('🚀 Launching browser...');
    const browser = await puppeteer.default.launch({
      headless: true,
      devtools: false,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--disable-default-apps',
        '--disable-extensions'
      ],
      timeout: 10000 // 10 second timeout
    });
    
    console.log('✅ Browser launched');
    
    const page = await browser.newPage();
    console.log('✅ Page created');
    
    // Set a shorter timeout for page operations
    page.setDefaultTimeout(10000);
    
    // Try to navigate to companies page where QuickAddCompany should be available
    const companiesUrl = `${BASE_URL}/msp/companies`;
    console.log(`📍 Navigating to ${companiesUrl}...`);
    
    try {
      await page.goto(companiesUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      console.log('✅ Companies page loaded');
    } catch (error) {
      console.log('⚠️  Companies page failed, trying dashboard...');
      await page.goto(`${BASE_URL}/msp/dashboard`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      console.log('✅ Dashboard page loaded');
    }
    
    console.log('📋 Checking for UI state...');
    const state = await getUIState.execute(page, { jsonpath: '$.components[*]' });
    
    if (state.result && Array.isArray(state.result)) {
      console.log(`✅ Found ${state.result.length} UI components`);
      
      // Look for dialog components
      const dialogs = state.result.filter((c: any) => 
        c.type === 'dialog' || c.id?.includes('dialog') || c.id?.includes('quick-add')
      );
      
      if (dialogs.length > 0) {
        console.log('🎯 Found dialog components:');
        dialogs.forEach((d: any) => {
          console.log(`   - ${d.id} (${d.type}): ${d.label || 'no label'}`);
        });
      } else {
        console.log('❌ No dialog components found in UI state');
      }
      
      // Show first few components for debugging
      console.log('\n📋 First 5 components found:');
      state.result.slice(0, 5).forEach((c: any, i: number) => {
        console.log(`   ${i + 1}. ${c.id} (${c.type}): ${c.label || 'no label'}`);
      });
      
    } else {
      console.log('❌ No UI state components found');
      console.log('State result:', state);
    }
    
    console.log('\n🔍 Checking DOM for QuickAddCompany elements...');
    const domCheck = await page.evaluate(() => {
      const results = {
        dialogByAutomationId: !!document.querySelector('[data-automation-id="quick-add-company-dialog"]'),
        dialogById: !!document.getElementById('quick-add-company-dialog'),
        formByAutomationId: !!document.querySelector('[data-automation-id="quick-add-company-form"]'),
        formById: !!document.getElementById('quick-add-company-form'),
        anyDialogs: document.querySelectorAll('[role="dialog"], .dialog, [data-testid*="dialog"]').length,
        totalElements: document.querySelectorAll('*').length
      };
      return results;
    });
    
    console.log('DOM Check Results:', domCheck);
    
    await browser.close();
    console.log('✅ Browser closed');
    
    // Summary
    console.log('\n📊 Test Summary:');
    console.log('================');
    if (state.result && Array.isArray(state.result) && state.result.length > 0) {
      console.log('✅ UI reflection system is working');
      console.log(`   Found ${state.result.length} registered components`);
    } else {
      console.log('❌ UI reflection system may not be working');
      console.log('   No components found in UI state');
    }
    
    const quickAddFound = state.result?.some((c: any) => 
      c.id?.includes('quick-add-company') || c.id?.includes('quick-add')
    );
    
    if (quickAddFound) {
      console.log('✅ QuickAddCompany dialog found in UI state!');
    } else {
      console.log('❌ QuickAddCompany dialog NOT found in UI state');
      console.log('   This could mean:');
      console.log('   1. Dialog is not currently open');
      console.log('   2. UI reflection integration is incomplete');
      console.log('   3. Component is not registering properly');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testQuickAddCompanySimple();