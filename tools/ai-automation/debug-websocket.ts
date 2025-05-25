#!/usr/bin/env node

/**
 * Debug WebSocket connection between frontend and automation server
 */

console.log('🔌 Testing WebSocket connection to automation server...\n');

async function debugWebSocket() {
  try {
    const puppeteer = await import('puppeteer');
    
    const browser = await puppeteer.default.launch({
      headless: false,
      devtools: true, // Open DevTools automatically
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Enable console logging from the page
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      console.log(`[PAGE ${type.toUpperCase()}] ${text}`);
    });
    
    // Enable error logging
    page.on('pageerror', error => {
      console.log(`[PAGE ERROR] ${error.message}`);
    });
    
    console.log('📍 Navigating to localhost:3000...');
    await page.goto('http://localhost:3000/msp/companies', { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });
    
    console.log('🔍 Checking WebSocket connection status...');
    
    // Check for WebSocket connections and UI state
    const wsStatus = await page.evaluate(() => {
      // Check for Socket.IO connections
      const socketIoConnections = (window as any).io;
      
      // Check for UI state context
      const hasUIStateContext = !!(window as any).UIStateContext;
      
      // Check for React DevTools
      const hasReact = !!(window as any).React;
      
      // Check console for any errors
      return {
        hasSocketIO: !!socketIoConnections,
        hasUIStateContext,
        hasReact,
        url: window.location.href,
        userAgent: navigator.userAgent
      };
    });
    
    console.log('WebSocket Status:', wsStatus);
    
    console.log('\n🔍 Looking for any connection errors in console...');
    console.log('Check the browser DevTools console for WebSocket connection errors');
    console.log('Browser will stay open for 60 seconds for manual inspection...');
    
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    await browser.close();
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
}

debugWebSocket();