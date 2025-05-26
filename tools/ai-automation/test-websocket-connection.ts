#!/usr/bin/env node

/**
 * Simple test to verify WebSocket connection and UI state registration
 */

async function testWebSocketConnection() {
  let browser;
  
  try {
    console.log('🧪 Testing WebSocket Connection and UI State...\n');
    
    const puppeteer = await import('puppeteer');
    
    console.log('🚀 Launching browser...');
    browser = await puppeteer.default.launch({
      headless: false,
      devtools: true, // Enable DevTools for debugging
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1900,1200']
    });

    const page = await browser.newPage();
    
    // Enable console logging from the page
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('UI-STATE') || text.includes('WEBSOCKET') || text.includes('🔌')) {
        console.log(`🖥️  [BROWSER] ${text}`);
      }
    });

    console.log('📍 Navigating to login page...');
    await page.goto('http://localhost:3000/auth/signin?callbackUrl=%2Fmsp%2Fdashboard');
    
    console.log('🔐 Logging in...');
    await page.waitForSelector('[type="email"]', { timeout: 10000 });
    await page.type('[type="email"]', 'robert@emeraldcity.oz');
    await page.type('[type="password"]', '555');
    await page.click('[type="submit"]');
    
    console.log('⏳ Waiting for authentication and page load...');
    await page.waitForURL('**/msp/dashboard', { timeout: 15000 });
    
    console.log('📍 Navigating to companies page...');
    await page.goto('http://localhost:3000/msp/companies');
    await page.waitForSelector('#create-client-btn', { timeout: 10000 });
    
    // Wait a bit for potential WebSocket connection
    console.log('⏳ Waiting 3 seconds for UI state initialization...');
    await page.waitForTimeout(3000);
    
    // Check for WebSocket connection in the browser
    const wsConnectionStatus = await page.evaluate(() => {
      // Check if there's a global socket or similar
      return {
        hasSocket: typeof window !== 'undefined' && 'socket' in window,
        hasIo: typeof window !== 'undefined' && 'io' in window,
        socketIoClient: typeof window !== 'undefined' && !!window.io,
        websocketConnections: (window as any).WebSocket ? 'WebSocket available' : 'No WebSocket'
      };
    });
    
    console.log('🔍 WebSocket status in browser:', wsConnectionStatus);
    
    // Check if UIStateContext is working
    const uiContextStatus = await page.evaluate(() => {
      // Look for React DevTools or context data
      return {
        hasReact: typeof window !== 'undefined' && '__REACT_DEVTOOLS_GLOBAL_HOOK__' in window,
        reactVersion: (window as any).React?.version || 'Not found'
      };
    });
    
    console.log('⚛️  React status:', uiContextStatus);
    
    console.log('\n📋 Press Ctrl+C when ready to close browser...');
    
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

testWebSocketConnection().catch(console.error);