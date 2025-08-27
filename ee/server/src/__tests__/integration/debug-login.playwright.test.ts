/**
 * Debug test to examine the actual login page structure
 */

import { test } from '@playwright/test';

test('debug login page structure', async ({ page }) => {
  // Navigate to root path
  await page.goto('/');
  
  // Wait for page to load
  await page.waitForLoadState('networkidle');
  
  // Take a screenshot
  await page.screenshot({ path: 'debug-login-page.png', fullPage: true });
  
  // Print page content for debugging
  const pageContent = await page.content();
  console.log('Page HTML:', pageContent.substring(0, 2000) + '...');
  
  // Check what form elements exist
  const emailInputs = await page.locator('input[type="email"]').count();
  const passwordInputs = await page.locator('input[type="password"]').count();
  const submitButtons = await page.locator('button[type="submit"]').count();
  
  console.log(`Found ${emailInputs} email inputs, ${passwordInputs} password inputs, ${submitButtons} submit buttons`);
  
  // List all input elements
  const allInputs = await page.locator('input').all();
  for (let i = 0; i < allInputs.length; i++) {
    const input = allInputs[i];
    const id = await input.getAttribute('id');
    const type = await input.getAttribute('type');
    const name = await input.getAttribute('name');
    console.log(`Input ${i}: id="${id}", type="${type}", name="${name}"`);
  }
  
  // List all buttons
  const allButtons = await page.locator('button').all();
  for (let i = 0; i < allButtons.length; i++) {
    const button = allButtons[i];
    const id = await button.getAttribute('id');
    const type = await button.getAttribute('type');
    const text = await button.textContent();
    console.log(`Button ${i}: id="${id}", type="${type}", text="${text}"`);
  }
});