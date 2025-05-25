#!/usr/bin/env node

/**
 * Comprehensive test for QuickAddCompany UI state with authentication
 */

console.log('🧪 Testing QuickAddCompany UI State with Authentication...\n');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_EMAIL = process.env.TEST_EMAIL || 'robert@emeraldcity.oz';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '555';

async function testWithAuthentication() {
  let browser;
  
  try {
    console.log('📦 Importing dependencies...');
    const puppeteer = await import('puppeteer');
    const { PuppeteerHelper } = await import('./src/puppeteerHelper.js');
    const { getUIState } = await import('./src/tools/getUIState.js');
    const { takeScreenshot } = await import('./src/tools/takeScreenshot.js');
    console.log('✅ Dependencies loaded');

    console.log('🚀 Launching browser...');
    browser = await puppeteer.default.launch({
      headless: false, // Set to true for CI
      devtools: false,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ],
      defaultViewport: { width: 1280, height: 720 }
    });
    
    const page = await browser.newPage();
    const helper = new PuppeteerHelper(page);
    
    // Set longer timeout for auth operations
    page.setDefaultTimeout(30000);
    
    console.log('📍 Step 1: Navigate to application...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
    
    // Take screenshot of initial page
    await takeScreenshot.execute(page, { filename: 'step1-initial-page.png' });
    
    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);
    
    // Check if we're on a sign-in page
    if (currentUrl.includes('/auth/signin') || currentUrl.includes('/login')) {
      console.log('🔐 Step 2: Authenticating...');
      
      // Try to find and fill email field
      const emailSelectors = ['#email', '[name="email"]', '[type="email"]', '#username', '[name="username"]'];
      let emailFound = false;
      
      for (const selector of emailSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 2000 });
          await page.type(selector, TEST_EMAIL);
          console.log(`✅ Email entered using selector: ${selector}`);
          emailFound = true;
          break;
        } catch (e) {
          console.log(`   ❌ Email selector ${selector} not found`);
        }
      }
      
      if (!emailFound) {
        console.log('❌ Could not find email field');
        await takeScreenshot.execute(page, { filename: 'step2-email-field-not-found.png' });
        throw new Error('Email field not found');
      }
      
      // Try to find and fill password field
      const passwordSelectors = ['#password', '[name="password"]', '[type="password"]'];
      let passwordFound = false;
      
      for (const selector of passwordSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 2000 });
          await page.type(selector, TEST_PASSWORD);
          console.log(`✅ Password entered using selector: ${selector}`);
          passwordFound = true;
          break;
        } catch (e) {
          console.log(`   ❌ Password selector ${selector} not found`);
        }
      }
      
      if (!passwordFound) {
        console.log('❌ Could not find password field');
        await takeScreenshot.execute(page, { filename: 'step2-password-field-not-found.png' });
        throw new Error('Password field not found');
      }
      
      // Try to find and click submit button
      await takeScreenshot.execute(page, { filename: 'step2-before-submit.png' });
      
      const submitSelectors = [
        '[type="submit"]',
        'button[type="submit"]', 
        '#submit',
        '.submit-btn',
        'button:contains("Sign")',
        'button:contains("Login")',
        'button:contains("Submit")'
      ];
      
      let submitFound = false;
      for (const selector of submitSelectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            await element.click();
            console.log(`✅ Submit clicked using selector: ${selector}`);
            submitFound = true;
            break;
          }
        } catch (e) {
          console.log(`   ❌ Submit selector ${selector} not found`);
        }
      }
      
      if (!submitFound) {
        // Try finding submit button by text content
        try {
          await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const submitButton = buttons.find(btn => 
              btn.textContent?.toLowerCase().includes('sign') ||
              btn.textContent?.toLowerCase().includes('login') ||
              btn.textContent?.toLowerCase().includes('submit')
            );
            if (submitButton) {
              submitButton.click();
              return true;
            }
            return false;
          });
          console.log('✅ Submit button clicked by text content');
          submitFound = true;
        } catch (e) {
          console.log('❌ Could not find submit button');
          await takeScreenshot.execute(page, { filename: 'step2-submit-not-found.png' });
        }
      }
      
      if (submitFound) {
        console.log('⏳ Waiting for authentication...');
        try {
          await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 });
          console.log('✅ Authentication completed');
        } catch (e) {
          console.log('⚠️  Navigation timeout after submit, continuing...');
        }
      }
      
      await takeScreenshot.execute(page, { filename: 'step2-after-auth.png' });
    } else {
      console.log('✅ Already authenticated or no auth required');
    }
    
    console.log('📍 Step 3: Navigate to companies page...');
    await page.goto(`${BASE_URL}/msp/companies`, { waitUntil: 'networkidle0' });
    console.log(`Current URL after navigation: ${page.url()}`);
    
    await takeScreenshot.execute(page, { filename: 'step3-companies-page.png' });
    
    console.log('📋 Step 4: Check initial UI state...');
    const initialState = await getUIState.execute(page, { jsonpath: '$.components[*]' });
    
    if (initialState.result && Array.isArray(initialState.result)) {
      console.log(`✅ Found ${initialState.result.length} initial UI components`);
      
      // List some components for debugging
      console.log('First 10 components:');
      initialState.result.slice(0, 10).forEach((c: any, i: number) => {
        console.log(`   ${i + 1}. ${c.id} (${c.type}): ${c.label || 'no label'}`);
      });
      
      // Check if QuickAddCompany dialog is already there (shouldn't be)
      const existingDialog = initialState.result.find((c: any) => 
        c.id === 'quick-add-company-dialog'
      );
      
      if (existingDialog) {
        console.log('⚠️  QuickAddCompany dialog already found in UI state:', existingDialog);
      } else {
        console.log('✅ QuickAddCompany dialog not in initial state (expected)');
      }
      
    } else {
      console.log('❌ No UI components found in initial state');
      console.log('Initial state result:', initialState);
    }
    
    console.log('📍 Step 5: Look for "Add Company" or "Add Client" button...');
    
    // Try to find the button that opens QuickAddCompany
    const addButtonSelectors = [
      '#create-client-btn', // The actual button ID we found
      '[data-automation-id*="add"]',
      '[data-automation-id*="company"]',
      '[data-automation-id*="client"]',
      '#add-company-btn',
      '#add-client-btn',
      '#new-company-btn',
      '#new-client-btn',
      '.add-company',
      '.add-client'
    ];
    
    let addButtonFound = false;
    let usedSelector = '';
    
    for (const selector of addButtonSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          console.log(`✅ Found add button with selector: ${selector}`);
          await element.click();
          usedSelector = selector;
          addButtonFound = true;
          break;
        }
      } catch (e) {
        // Silent fail, try next selector
      }
    }
    
    if (!addButtonFound) {
      // Try finding by text content
      console.log('🔍 Searching for add button by text content...');
      const foundByText = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        const addButton = buttons.find(btn => {
          const text = btn.textContent?.toLowerCase() || '';
          return text.includes('add') && (text.includes('company') || text.includes('client'));
        });
        
        if (addButton) {
          addButton.click();
          return {
            found: true,
            text: addButton.textContent,
            tagName: addButton.tagName,
            id: addButton.id,
            className: addButton.className
          };
        }
        return { found: false };
      });
      
      if (foundByText.found) {
        console.log('✅ Found and clicked add button by text:', foundByText);
        addButtonFound = true;
        usedSelector = 'text-based';
      } else {
        console.log('❌ Could not find add company/client button');
        await takeScreenshot.execute(page, { filename: 'step5-no-add-button.png' });
      }
    }
    
    if (addButtonFound) {
      console.log('⏳ Waiting for dialog to appear...');
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for dialog animation
      
      await takeScreenshot.execute(page, { filename: 'step5-after-add-click.png' });
      
      console.log('📋 Step 6: Check UI state with dialog open...');
      const dialogState = await getUIState.execute(page, { jsonpath: '$.components[*]' });
      
      if (dialogState.result && Array.isArray(dialogState.result)) {
        console.log(`✅ Found ${dialogState.result.length} UI components with dialog open`);
        
        // Look for the QuickAddCompany dialog specifically
        const quickAddDialog = dialogState.result.find((c: any) => 
          c.id === 'quick-add-company-dialog' || c.id === 'quick-add-company-dialog-dialog'
        );
        
        if (quickAddDialog) {
          console.log('🎉 SUCCESS: QuickAddCompany dialog found in UI state!');
          console.log('Dialog details:', JSON.stringify(quickAddDialog, null, 2));
        } else {
          console.log('❌ QuickAddCompany dialog NOT found in UI state');
          
          // Look for any dialog components
          const anyDialogs = dialogState.result.filter((c: any) => 
            c.type === 'dialog' || c.id?.includes('dialog')
          );
          
          if (anyDialogs.length > 0) {
            console.log('Found other dialog components:');
            anyDialogs.forEach(d => console.log(`   - ${d.id} (${d.type})`));
          } else {
            console.log('No dialog components found at all');
          }
        }
        
        // Look for the form container
        const formContainer = dialogState.result.find((c: any) => 
          c.id === 'quick-add-company-form' || c.id.includes('quick-add-company-form')
        );
        
        if (formContainer) {
          console.log('✅ QuickAddCompany form container found in UI state');
          console.log('Form details:', JSON.stringify(formContainer, null, 2));
        } else {
          console.log('❌ QuickAddCompany form container NOT found in UI state');
        }
        
      } else {
        console.log('❌ No UI components found with dialog open');
      }
      
      console.log('🔍 Step 7: Check DOM for dialog elements...');
      const domCheck = await page.evaluate(() => {
        return {
          dialogByAutomationId: !!document.querySelector('[data-automation-id="quick-add-company-dialog"]'),
          dialogByAutomationIdWithSuffix: !!document.querySelector('[data-automation-id="quick-add-company-dialog-dialog"]'),
          dialogById: !!document.getElementById('quick-add-company-dialog'),
          formByAutomationId: !!document.querySelector('[data-automation-id="quick-add-company-form"]'),
          formById: !!document.getElementById('quick-add-company-form'),
          dialogVisible: (() => {
            const dialog = document.querySelector('[data-automation-id="quick-add-company-dialog"]') ||
                          document.querySelector('[data-automation-id="quick-add-company-dialog-dialog"]') ||
                          document.getElementById('quick-add-company-dialog');
            return dialog ? dialog.offsetParent !== null : false;
          })(),
          anyOpenDialogs: document.querySelectorAll('[role="dialog"]:not([hidden]), .modal:not([hidden])').length
        };
      });
      
      console.log('DOM Check Results:', domCheck);
      
    } else {
      console.log('⚠️  Skipping dialog test - could not find add button');
    }
    
    console.log('\n📊 Final Test Results:');
    console.log('======================');
    
    // Re-check final state
    const finalState = await getUIState.execute(page, { jsonpath: '$.components[?(@.id=="quick-add-company-dialog" || @.id=="quick-add-company-dialog-dialog")]' });
    
    if (finalState.result && !finalState.result.message) {
      console.log('🎉 SUCCESS: QuickAddCompany dialog integration is working!');
      console.log('   The dialog appears correctly in the UI state.');
    } else {
      console.log('❌ FAILURE: QuickAddCompany dialog not found in UI state');
      console.log('   Possible issues:');
      console.log('   1. Dialog is not actually open');
      console.log('   2. useAutomationIdAndRegister is not working properly');
      console.log('   3. ReflectionContainer is not registering components');
      console.log('   4. UI reflection system has other issues');
    }
    
    // Keep browser open for manual inspection
    console.log('\n🔍 Browser will stay open for 30 seconds for manual inspection...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.log('\n🔍 Browser will stay open for manual inspection...');
    await new Promise(resolve => setTimeout(resolve, 10000));
  } finally {
    if (browser) {
      await browser.close();
      console.log('🧹 Browser closed');
    }
  }
}

// Run the test
testWithAuthentication();