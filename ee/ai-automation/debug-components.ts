#!/usr/bin/env node

/**
 * Debug which components are actually registering with UI reflection
 */

console.log('🔍 Debugging UI component registration...\n');

async function debugComponents() {
  try {
    const puppeteer = await import('puppeteer');
    const { getUIState } = await import('./src/tools/getUIState.js');
    
    const browser = await puppeteer.default.launch({
      headless: false,
      devtools: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Log all console messages
    page.on('console', msg => {
      console.log(`[BROWSER] ${msg.type()}: ${msg.text()}`);
    });
    
    page.on('pageerror', error => {
      console.log(`[BROWSER ERROR] ${error.message}`);
    });
    
    console.log('🔐 Logging in...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    
    // Quick login
    try {
      await page.type('[type="email"]', 'robert@emeraldcity.oz');
      await page.type('[type="password"]', '555');
      await page.click('[type="submit"]');
      await page.waitForNavigation({ waitUntil: 'networkidle0' });
    } catch (e) {
      console.log('Login may have failed, continuing...');
    }
    
    console.log('📍 Going to companies page...');
    await page.goto('http://localhost:3000/msp/companies', { waitUntil: 'networkidle0' });
    
    // Wait a bit for components to register
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('📋 Checking ALL registered components...');
    const allComponents = await getUIState.execute(page, { jsonpath: '$.*' });
    
    console.log('Full UI State:', JSON.stringify(allComponents, null, 2));
    
    console.log('\n🔍 Looking for React components with useAutomationIdAndRegister...');
    
    // Check if React DevTools shows any registered components
    const reactInfo = await page.evaluate(() => {
      // Try to find React components
      const reactRoot = document.querySelector('#__next') || document.querySelector('[data-reactroot]');
      
      // Check for any elements with data-automation-id
      const automationElements = Array.from(document.querySelectorAll('[data-automation-id]'));
      
      return {
        hasReactRoot: !!reactRoot,
        automationElements: automationElements.map(el => ({
          id: el.getAttribute('data-automation-id'),
          tagName: el.tagName,
          id_attr: el.id,
          classes: el.className
        })),
        totalElements: document.querySelectorAll('*').length
      };
    });
    
    console.log('React Info:', reactInfo);
    
    if (reactInfo.automationElements.length > 0) {
      console.log('\n✅ Found elements with data-automation-id:');
      reactInfo.automationElements.forEach(el => {
        console.log(`   - ${el.id} (${el.tagName})`);
      });
    } else {
      console.log('\n❌ No elements found with data-automation-id');
      console.log('This suggests useAutomationIdAndRegister is not working');
    }
    
    console.log('\n⏳ Browser staying open for manual inspection...');
    console.log('Check the React DevTools and console for more info');
    
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    await browser.close();
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
}

debugComponents();