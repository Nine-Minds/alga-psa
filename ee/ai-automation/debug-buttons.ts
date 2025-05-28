#!/usr/bin/env node

/**
 * Debug what buttons are actually available on the companies page
 */

console.log('🔍 Finding all buttons on companies page...\n');

async function debugButtons() {
  try {
    const puppeteer = await import('puppeteer');
    
    const browser = await puppeteer.default.launch({
      headless: false,
      devtools: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
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
    
    // Wait for page to fully load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('🔍 Finding ALL buttons on the page...');
    
    const allButtons = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], a[href*="add"], a[href*="create"], a[href*="new"]'));
      
      return buttons.map((btn, index) => ({
        index,
        tagName: btn.tagName,
        id: btn.id || '',
        automationId: btn.getAttribute('data-automation-id') || '',
        className: btn.className,
        textContent: btn.textContent?.trim() || '',
        href: btn.getAttribute('href') || '',
        visible: btn.offsetParent !== null,
        disabled: btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true'
      })).filter(btn => 
        // Filter for buttons that might create/add something
        btn.visible && (
          btn.textContent.toLowerCase().includes('add') ||
          btn.textContent.toLowerCase().includes('create') ||
          btn.textContent.toLowerCase().includes('new') ||
          btn.textContent.toLowerCase().includes('client') ||
          btn.textContent.toLowerCase().includes('company') ||
          btn.id.toLowerCase().includes('add') ||
          btn.id.toLowerCase().includes('create') ||
          btn.id.toLowerCase().includes('client') ||
          btn.automationId.toLowerCase().includes('add') ||
          btn.automationId.toLowerCase().includes('create') ||
          btn.automationId.toLowerCase().includes('client')
        )
      );
    });
    
    console.log('\n📋 Found potential "Add/Create" buttons:');
    console.log('===============================================');
    
    if (allButtons.length === 0) {
      console.log('❌ No add/create buttons found!');
    } else {
      allButtons.forEach((btn, i) => {
        console.log(`${i + 1}. "${btn.textContent}"`);
        console.log(`   Tag: ${btn.tagName}`);
        console.log(`   ID: ${btn.id || '(none)'}`);
        console.log(`   Automation ID: ${btn.automationId || '(none)'}`);
        console.log(`   Classes: ${btn.className}`);
        console.log(`   Disabled: ${btn.disabled}`);
        console.log('   ---');
      });
    }
    
    // Look specifically for create-client-btn
    console.log('\n🎯 Looking specifically for "create-client-btn"...');
    
    const createClientBtn = await page.evaluate(() => {
      const btn = document.getElementById('create-client-btn');
      if (btn) {
        return {
          found: true,
          tagName: btn.tagName,
          id: btn.id,
          automationId: btn.getAttribute('data-automation-id'),
          textContent: btn.textContent?.trim(),
          visible: btn.offsetParent !== null,
          disabled: btn.hasAttribute('disabled'),
          className: btn.className
        };
      }
      return { found: false };
    });
    
    if (createClientBtn.found) {
      console.log('✅ Found create-client-btn:', createClientBtn);
      
      console.log('\n🖱️ Trying to click create-client-btn...');
      try {
        await page.click('#create-client-btn');
        console.log('✅ Successfully clicked create-client-btn');
        
        // Wait for dialog to appear
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check if dialog appeared
        const dialogCheck = await page.evaluate(() => {
          return {
            dialogByAutomationId: !!document.querySelector('[data-automation-id="quick-add-company-dialog"]'),
            dialogById: !!document.getElementById('quick-add-company-dialog'),
            anyDialogs: document.querySelectorAll('[role="dialog"], .modal, [data-automation-id*="dialog"]').length,
            dialogElements: Array.from(document.querySelectorAll('[role="dialog"], .modal, [data-automation-id*="dialog"]')).map(el => ({
              tagName: el.tagName,
              id: el.id,
              automationId: el.getAttribute('data-automation-id'),
              visible: el.offsetParent !== null,
              className: el.className
            }))
          };
        });
        
        console.log('\n📋 Dialog check results:', dialogCheck);
        
      } catch (error) {
        console.log('❌ Failed to click create-client-btn:', error);
      }
    } else {
      console.log('❌ create-client-btn not found');
    }
    
    console.log('\n⏳ Browser staying open for 30 seconds for manual inspection...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    await browser.close();
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
}

debugButtons();