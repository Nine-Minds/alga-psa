/**
 * Debug test to see what happens with failed login
 */

import { test } from '@playwright/test';

test('debug failed login behavior', async ({ page }) => {
  // Navigate to root path
  await page.goto('/');
  
  // Wait for login form to appear
  await page.waitForSelector('#msp-email-field');
  
  // Fill invalid credentials
  await page.fill('#msp-email-field', 'invalid@example.com');
  await page.fill('#msp-password-field', 'wrongpassword');
  
  // Take screenshot before login
  await page.screenshot({ path: 'debug-before-login.png', fullPage: true });
  
  // Click login button
  await page.click('#msp-sign-in-button');
  
  // Wait a bit for response
  await page.waitForTimeout(3000);
  
  // Take screenshot after login attempt
  await page.screenshot({ path: 'debug-after-failed-login.png', fullPage: true });
  
  // Look for specific error-related text
  const pageContent = await page.content();
  if (pageContent.includes('Invalid') || pageContent.includes('error') || pageContent.includes('Error')) {
    console.log('Page contains error-related text');
  } else {
    console.log('No error text found in page');
  }
  
  // Look for any alert/dialog elements
  const alerts = await page.locator('[role="alert"], [role="dialog"], .alert, .error').all();
  console.log(`Found ${alerts.length} alert/dialog elements`);
  
  for (let i = 0; i < alerts.length; i++) {
    const alert = alerts[i];
    const text = await alert.textContent();
    const isVisible = await alert.isVisible();
    console.log(`Alert ${i}: visible=${isVisible}, text="${text}"`);
  }
  
  // Check page URL after failed login
  console.log('URL after failed login:', page.url());
});