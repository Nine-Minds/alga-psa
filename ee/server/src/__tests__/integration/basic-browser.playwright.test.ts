/**
 * Basic browser test to verify Playwright is working
 */

import { test, expect } from '@playwright/test';

test.describe('Basic Browser Test', () => {
  test('should load a simple page', async ({ page }) => {
    // Navigate to a simple test page
    await page.goto('data:text/html,<html><body><h1>Test Page</h1><p>Hello World</p></body></html>');
    
    // Verify page content
    await expect(page.locator('h1')).toHaveText('Test Page');
    await expect(page.locator('p')).toHaveText('Hello World');
  });

  test('should handle basic page interactions', async ({ page }) => {
    // Create a simple interactive page
    await page.goto(`data:text/html,
      <html>
        <body>
          <h1>Interactive Test</h1>
          <button id="test-btn">Click Me</button>
          <div id="result">Not clicked</div>
          <script>
            document.getElementById('test-btn').addEventListener('click', function() {
              document.getElementById('result').textContent = 'Clicked!';
            });
          </script>
        </body>
      </html>
    `);
    
    // Verify initial state
    await expect(page.locator('#result')).toHaveText('Not clicked');
    
    // Click button and verify change
    await page.click('#test-btn');
    await expect(page.locator('#result')).toHaveText('Clicked!');
  });

  test('should take a screenshot', async ({ page }) => {
    await page.goto('data:text/html,<html><body><h1>Screenshot Test</h1></body></html>');
    
    // Take a screenshot
    await page.screenshot({ path: 'screenshots/basic-test.png' });
    
    // Verify the page loaded
    await expect(page.locator('h1')).toHaveText('Screenshot Test');
  });
});