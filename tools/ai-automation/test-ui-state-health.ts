#!/usr/bin/env node

/**
 * Check if UI state system is working at all or completely broken
 */

console.log('🏥 UI State System Health Check...\n');

async function checkUIStateHealth() {
  try {
    const puppeteer = await import('puppeteer');
    const { getUIState } = await import('./src/tools/getUIState.js');
    
    const browser = await puppeteer.default.launch({
      headless: false,
      devtools: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Monitor browser console for UI reflection messages
    const uiReflectionLogs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('Component with ID') || 
          text.includes('Connected to AI Backend') ||
          text.includes('UI_STATE_UPDATE') ||
          text.includes('registerComponent') ||
          text.includes('unregisterComponent')) {
        uiReflectionLogs.push(`[${msg.type()}] ${text}`);
      }
    });
    
    console.log('🔐 Logging in...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    
    try {
      await page.type('[type="email"]', 'robert@emeraldcity.oz');
      await page.type('[type="password"]', '555');
      await page.click('[type="submit"]');
      await page.waitForNavigation({ waitUntil: 'networkidle0' });
    } catch (e) {
      console.log('Login issue, continuing...');
    }
    
    console.log('📍 Going to companies page...');
    await page.goto('http://localhost:3000/msp/companies', { waitUntil: 'networkidle0' });
    
    // Wait for components to register
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('\n📋 Checking UI State Health...');
    console.log('=====================================');
    
    // 1. Check if ANY components are in UI state
    console.log('1️⃣ Checking for ANY components in UI state...');
    const allComponents = await getUIState.execute(page, { jsonpath: '$.components[*]' });
    
    if (allComponents.result && Array.isArray(allComponents.result) && allComponents.result.length > 0) {
      console.log(`✅ UI State is working! Found ${allComponents.result.length} components`);
      
      console.log('\nFirst 10 components:');
      allComponents.result.slice(0, 10).forEach((c: any, i: number) => {
        console.log(`   ${i + 1}. ${c.id} (${c.type}): ${c.label || 'no label'}`);
      });
      
      // 2. Check if dialogs are registering in general
      console.log('\n2️⃣ Checking for ANY dialog components...');
      const dialogs = allComponents.result.filter((c: any) => c.type === 'dialog' || c.id?.includes('dialog'));
      
      if (dialogs.length > 0) {
        console.log(`✅ Found ${dialogs.length} dialog components:`);
        dialogs.forEach(d => {
          console.log(`   - ${d.id} (${d.type}): open=${d.open}, visible=${d.visible}`);
        });
      } else {
        console.log('❌ No dialog components found in UI state');
      }
      
      // 3. Check specifically for QuickAddCompany
      console.log('\n3️⃣ Checking specifically for QuickAddCompany...');
      const quickAddComponents = allComponents.result.filter((c: any) => 
        c.id?.includes('quick-add') || c.id?.includes('company')
      );
      
      if (quickAddComponents.length > 0) {
        console.log('✅ Found QuickAdd-related components:');
        quickAddComponents.forEach(c => {
          console.log(`   - ${c.id} (${c.type}): ${JSON.stringify(c, null, 2)}`);
        });
      } else {
        console.log('❌ No QuickAdd-related components found');
      }
      
    } else {
      console.log('❌ UI State is completely broken - no components found');
      console.log('Raw response:', allComponents);
    }
    
    // 4. Check DOM vs UI State mismatch
    console.log('\n4️⃣ Checking DOM vs UI State mismatch...');
    const domElements = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('[data-automation-id]'));
      return elements.map(el => ({
        id: el.getAttribute('data-automation-id'),
        tagName: el.tagName,
        visible: el.offsetParent !== null
      }));
    });
    
    console.log(`DOM has ${domElements.length} elements with data-automation-id`);
    
    if (allComponents.result && Array.isArray(allComponents.result)) {
      const uiStateIds = allComponents.result.map((c: any) => c.id);
      const domIds = domElements.map(el => el.id);
      
      const inDomButNotUIState = domIds.filter(id => !uiStateIds.includes(id));
      const inUIStateButNotDOM = uiStateIds.filter(id => !domIds.includes(id));
      
      if (inDomButNotUIState.length > 0) {
        console.log(`❌ ${inDomButNotUIState.length} elements in DOM but NOT in UI state:`);
        inDomButNotUIState.slice(0, 5).forEach(id => console.log(`   - ${id}`));
      }
      
      if (inUIStateButNotDOM.length > 0) {
        console.log(`❌ ${inUIStateButNotDOM.length} components in UI state but NOT in DOM:`);
        inUIStateButNotDOM.slice(0, 5).forEach(id => console.log(`   - ${id}`));
      }
      
      if (inDomButNotUIState.length === 0 && inUIStateButNotDOM.length === 0) {
        console.log('✅ DOM and UI State are synchronized');
      }
    }
    
    // 5. Show browser console logs related to UI reflection
    console.log('\n5️⃣ UI Reflection Console Logs:');
    if (uiReflectionLogs.length > 0) {
      uiReflectionLogs.forEach(log => console.log(`   ${log}`));
    } else {
      console.log('❌ No UI reflection logs found - system may not be working');
    }
    
    console.log('\n📊 DIAGNOSIS:');
    console.log('==============');
    
    if (allComponents.result && Array.isArray(allComponents.result) && allComponents.result.length > 0) {
      console.log('✅ UI State System: WORKING');
      console.log('🎯 Focus: QuickAddCompany specific integration issue');
      console.log('   - Other components are registering successfully');
      console.log('   - Problem is likely in QuickAddCompany component logic');
      console.log('   - Check useAutomationIdAndRegister usage in QuickAddCompany');
    } else {
      console.log('❌ UI State System: COMPLETELY BROKEN');
      console.log('🎯 Focus: Core infrastructure issue');
      console.log('   - WebSocket connection problems');
      console.log('   - UIStateProvider not working');
      console.log('   - Automation server not receiving/storing state');
    }
    
    console.log('\n⏳ Browser staying open for manual inspection...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    await browser.close();
    
  } catch (error) {
    console.error('❌ Health check failed:', error);
  }
}

checkUIStateHealth();