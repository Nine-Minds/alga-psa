#!/usr/bin/env node

/**
 * Test WebSocket flow with detailed logging to diagnose the connection
 */

console.log('🔌 Testing WebSocket Flow with Detailed Logging...\n');

async function testWebSocketFlow() {
  try {
    const puppeteer = await import('puppeteer');
    
    const browser = await puppeteer.default.launch({
      headless: false,
      devtools: true, // Open DevTools to see logs
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Capture ALL console messages with timestamps
    const logs: Array<{time: number, type: string, text: string}> = [];
    page.on('console', msg => {
      const log = {
        time: Date.now(),
        type: msg.type(),
        text: msg.text()
      };
      logs.push(log);
      
      // Print UI-STATE related logs immediately
      if (log.text.includes('[UI-STATE]') || 
          log.text.includes('Connected to AI Backend') ||
          log.text.includes('Component with ID')) {
        console.log(`[${new Date(log.time).toLocaleTimeString()}] [${log.type.toUpperCase()}] ${log.text}`);
      }
    });
    
    console.log('📍 Step 1: Navigate and authenticate...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    
    try {
      await page.type('[type="email"]', 'robert@emeraldcity.oz');
      await page.type('[type="password"]', '555');
      await page.click('[type="submit"]');
      await page.waitForNavigation({ waitUntil: 'networkidle0' });
    } catch (e) {
      console.log('Auth issues, continuing...');
    }
    
    console.log('📍 Step 2: Go to companies page...');
    await page.goto('http://localhost:3000/msp/companies', { waitUntil: 'networkidle0' });
    
    console.log('📍 Step 3: Wait for initial component registration...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('📍 Step 4: Click create client button to trigger state change...');
    try {
      await page.click('#create-client-btn');
      console.log('✅ Clicked create-client-btn');
      
      // Wait for dialog and any state updates
      await new Promise(resolve => setTimeout(resolve, 3000));
      
    } catch (e) {
      console.log('❌ Failed to click create-client-btn:', e);
    }
    
    console.log('\n📊 WebSocket Flow Analysis:');
    console.log('============================');
    
    // Filter and analyze UI-STATE logs
    const uiStateLogs = logs.filter(log => 
      log.text.includes('[UI-STATE]') || 
      log.text.includes('Connected to AI Backend') ||
      log.text.includes('Component with ID')
    );
    
    console.log(`\nFound ${uiStateLogs.length} UI state related logs:`);
    
    // Check for connection
    const connectionLogs = uiStateLogs.filter(log => 
      log.text.includes('Connected to AI Backend') ||
      log.text.includes('Socket') ||
      log.text.includes('connection')
    );
    
    if (connectionLogs.length > 0) {
      console.log('\n✅ WebSocket Connection Logs:');
      connectionLogs.forEach(log => {
        console.log(`   [${new Date(log.time).toLocaleTimeString()}] ${log.text}`);
      });
    } else {
      console.log('\n❌ No WebSocket connection logs found');
    }
    
    // Check for component registration
    const registrationLogs = uiStateLogs.filter(log => 
      log.text.includes('Registering') ||
      log.text.includes('Component with ID')
    );
    
    if (registrationLogs.length > 0) {
      console.log('\n✅ Component Registration Logs:');
      registrationLogs.forEach(log => {
        console.log(`   [${new Date(log.time).toLocaleTimeString()}] ${log.text}`);
      });
    } else {
      console.log('\n❌ No component registration logs found');
    }
    
    // Check for state updates
    const stateUpdateLogs = uiStateLogs.filter(log => 
      log.text.includes('UI_STATE_UPDATE') ||
      log.text.includes('State updated') ||
      log.text.includes('Sending')
    );
    
    if (stateUpdateLogs.length > 0) {
      console.log('\n✅ State Update Logs:');
      stateUpdateLogs.forEach(log => {
        console.log(`   [${new Date(log.time).toLocaleTimeString()}] ${log.text}`);
      });
    } else {
      console.log('\n❌ No state update logs found');
    }
    
    // Check for any error logs
    const errorLogs = logs.filter(log => 
      log.type === 'error' || 
      log.text.includes('error') || 
      log.text.includes('Error') ||
      log.text.includes('❌')
    );
    
    if (errorLogs.length > 0) {
      console.log('\n⚠️ Error Logs:');
      errorLogs.forEach(log => {
        console.log(`   [${new Date(log.time).toLocaleTimeString()}] [${log.type}] ${log.text}`);
      });
    }
    
    console.log('\n🎯 Diagnosis:');
    console.log('==============');
    
    if (connectionLogs.length === 0) {
      console.log('❌ WebSocket connection is not being established');
      console.log('   - Check if automation server is running on port 4000');
      console.log('   - Check network connectivity');
    } else if (registrationLogs.length === 0) {
      console.log('❌ Components are not registering');
      console.log('   - Check useAutomationIdAndRegister usage');
      console.log('   - Check UIStateProvider setup');
    } else if (stateUpdateLogs.length === 0) {
      console.log('❌ State updates are not being sent');
      console.log('   - Check pageState updates in UIStateContext');
      console.log('   - Check WebSocket emit calls');
    } else {
      console.log('✅ WebSocket flow appears to be working');
      console.log('   - Check automation server logs for message receipt');
    }
    
    console.log('\n⏳ Browser staying open for 60 seconds for manual inspection...');
    console.log('Check browser DevTools console for more details');
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    await browser.close();
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testWebSocketFlow();