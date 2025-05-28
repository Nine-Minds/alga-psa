#!/usr/bin/env node

/**
 * Test to check UI state at multiple points to catch timing issues
 */

async function testUIStateTiming() {
  let browser;
  
  try {
    console.log('🧪 Testing UI State Timing Issues...\n');
    
    const puppeteer = await import('puppeteer');
    const { getUIState } = await import('./src/tools/getUIState.js');
    
    console.log('🚀 Launching browser...');
    browser = await puppeteer.default.launch({
      headless: false,
      devtools: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1900,1200']
    });

    const page = await browser.newPage();
    
    // Helper function to check UI state
    const checkUIState = async (step: string) => {
      console.log(`\n🔍 [${step}] Checking UI state...`);
      const result = await getUIState.execute(page, {});
      
      if (result.result?.error) {
        console.log(`❌ [${step}] No UI state: ${result.result.message}`);
        return null;
      } else {
        const componentCount = result.result?.components?.length || 0;
        console.log(`✅ [${step}] Found ${componentCount} components`);
        
        // Look for dialog specifically
        const components = result.result?.components || [];
        const dialogs = components.filter((c: any) => c.type === 'dialog');
        const quickAddDialog = components.find((c: any) => c.id?.includes('quick-add-company'));
        
        console.log(`   - Dialog components: ${dialogs.length}`);
        console.log(`   - QuickAdd dialog: ${quickAddDialog ? 'FOUND' : 'NOT FOUND'}`);
        
        if (quickAddDialog) {
          console.log(`   - QuickAdd dialog ID: ${quickAddDialog.id}`);
          console.log(`   - QuickAdd dialog visible: ${quickAddDialog.visible}`);
        }
        
        return result.result;
      }
    };

    console.log('📍 Navigating to login page...');
    await page.goto('http://localhost:3000/auth/signin?callbackUrl=%2Fmsp%2Fdashboard');
    
    console.log('🔐 Logging in...');
    await page.waitForSelector('[type="email"]', { timeout: 10000 });
    await page.type('[type="email"]', 'robert@emeraldcity.oz');
    await page.type('[type="password"]', '555');
    await page.click('[type="submit"]');
    
    console.log('⏳ Waiting for authentication and navigation...');
    await page.waitForFunction(() => window.location.pathname.includes('/msp/dashboard'), { timeout: 15000 });
    
    // Check UI state after landing on dashboard
    await checkUIState('DASHBOARD');
    
    console.log('\n📍 Navigating to companies page...');
    await page.goto('http://localhost:3000/msp/companies');
    await page.waitForSelector('#create-client-btn', { timeout: 10000 });
    
    // Check UI state after companies page loads
    await checkUIState('COMPANIES_PAGE');
    
    console.log('\n📍 Clicking Add Client button...');
    await page.click('#create-client-btn');
    
    // Check UI state immediately after clicking
    await checkUIState('IMMEDIATELY_AFTER_CLICK');
    
    // Wait and check again
    console.log('\n⏳ Waiting 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    await checkUIState('AFTER_2_SECONDS');
    
    // Wait for dialog to appear in DOM
    console.log('\n⏳ Waiting for dialog in DOM...');
    try {
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
      console.log('✅ Dialog found in DOM');
    } catch (e) {
      console.log('❌ Dialog not found in DOM within 5 seconds');
    }
    
    await checkUIState('AFTER_DOM_WAIT');
    
    // Wait longer
    console.log('\n⏳ Waiting 5 more seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    await checkUIState('AFTER_7_SECONDS_TOTAL');
    
    console.log('\n🔍 Keeping browser open for manual inspection...');
    console.log('Press Ctrl+C when ready to close browser...');
    
    // Keep browser open for manual inspection
    await new Promise((resolve) => {
      process.on('SIGINT', () => {
        console.log('\n🧹 Closing browser...');
        resolve(null);
      });
    });
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

testUIStateTiming().catch(console.error);