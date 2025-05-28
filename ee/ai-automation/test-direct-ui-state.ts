#!/usr/bin/env node

/**
 * Test accessing UI state directly from the page context
 */

async function testDirectUIState() {
  let browser;
  
  try {
    console.log('🧪 Testing Direct UI State Access...\n');
    
    const puppeteer = await import('puppeteer');
    
    console.log('🚀 Launching browser...');
    browser = await puppeteer.default.launch({
      headless: false,
      devtools: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1900,1200']
    });

    const page = await browser.newPage();
    
    console.log('📍 Navigating to login page...');
    await page.goto('http://localhost:3000/auth/signin?callbackUrl=%2Fmsp%2Fdashboard');
    
    console.log('🔐 Logging in...');
    await page.waitForSelector('[type="email"]', { timeout: 10000 });
    await page.type('[type="email"]', 'robert@emeraldcity.oz');
    await page.type('[type="password"]', '555');
    await page.click('[type="submit"]');
    
    console.log('⏳ Waiting for authentication and navigation...');
    await page.waitForFunction(() => window.location.pathname.includes('/msp/dashboard'), { timeout: 15000 });
    
    console.log('📍 Navigating to companies page...');
    await page.goto('http://localhost:3000/msp/companies');
    await page.waitForSelector('#create-client-btn', { timeout: 10000 });
    
    console.log('📍 Clicking Add Client button...');
    await page.click('#create-client-btn');
    
    // Wait for dialog
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    console.log('✅ Dialog found in DOM');
    
    // Try to access the Socket.IO client and any global state directly
    const pageState = await page.evaluate(() => {
      // Check if socket.io is available and connected
      const socketStatus = {
        hasIo: typeof (window as any).io !== 'undefined',
        hasSocket: typeof (window as any).socket !== 'undefined',
        socketConnected: (window as any).socket?.connected || false,
        socketId: (window as any).socket?.id || 'none'
      };
      
      // Try to find React contexts or global state
      const reactInfo = {
        hasReact: typeof (window as any).React !== 'undefined',
        hasReactDOM: typeof (window as any).ReactDOM !== 'undefined',
        hasDevTools: typeof (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ !== 'undefined'
      };
      
      // Look for any UI state data in global scope
      const globalVars = Object.keys(window).filter(key => 
        key.toLowerCase().includes('ui') || 
        key.toLowerCase().includes('state') ||
        key.toLowerCase().includes('context')
      );
      
      return {
        socketStatus,
        reactInfo,
        globalVars,
        url: window.location.href,
        title: document.title
      };
    });
    
    console.log('\n📋 Page State Analysis:');
    console.log('Socket Status:', pageState.socketStatus);
    console.log('React Info:', pageState.reactInfo);
    console.log('Global UI/State Variables:', pageState.globalVars);
    console.log('Page URL:', pageState.url);
    console.log('Page Title:', pageState.title);
    
    // Try to trigger a manual UI state send
    const triggerResult = await page.evaluate(() => {
      if ((window as any).socket?.connected) {
        try {
          // Try to manually trigger a UI state update if there's a global method
          const testState = {
            id: 'manual-test',
            title: 'Manual Test',
            components: [{
              id: 'test-component',
              type: 'button',
              label: 'Test Component'
            }]
          };
          
          (window as any).socket.emit('UI_STATE_UPDATE', testState);
          return { success: true, message: 'Manual UI state sent' };
        } catch (error) {
          return { success: false, error: error.message };
        }
      } else {
        return { success: false, message: 'Socket not connected' };
      }
    });
    
    console.log('\n🔧 Manual UI State Trigger Result:', triggerResult);
    
    console.log('\n🔍 Keeping browser open for inspection...');
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

testDirectUIState().catch(console.error);