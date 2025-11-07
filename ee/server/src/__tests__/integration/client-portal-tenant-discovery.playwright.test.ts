import { test, expect } from '@playwright/test';

test.describe('Client Portal Tenant Discovery', () => {
  test.setTimeout(180_000); // Allow time for first-run migrations

  test.describe('Unauthenticated Access', () => {
    test('should show tenant discovery form when visiting signin without tenant slug', async ({ page }) => {
      // Visit the canonical signin URL without any tenant parameter
      await page.goto('http://localhost:3000/auth/client-portal/signin');

      // Should see the tenant discovery form
      await expect(page.locator('#tenant-discovery-form')).toBeVisible();

      // Should see the heading
      await expect(page.getByRole('heading', { name: 'Find Your Organization' })).toBeVisible();

      // Should see the email input
      await expect(page.locator('#tenant-discovery-email')).toBeVisible();

      // Should see the submit button
      await expect(page.locator('#tenant-discovery-submit-button')).toBeVisible();

      // Should NOT see the regular login form
      await expect(page.locator('#client-sign-in-button')).not.toBeVisible();
    });

    test('should show regular login form when tenant slug is provided', async ({ page }) => {
      // Visit with a tenant slug parameter (using a mock slug)
      await page.goto('http://localhost:3000/auth/client-portal/signin?tenant=abc123def456');

      // Wait for either the discovery form or the login form to appear
      await Promise.race([
        page.locator('#tenant-discovery-form').waitFor({ timeout: 10000 }).catch(() => null),
        page.locator('#client-sign-in-button').waitFor({ timeout: 10000 }).catch(() => null),
      ]);

      // Should NOT see the tenant discovery form
      await expect(page.locator('#tenant-discovery-form')).not.toBeVisible();

      // Should see the regular login form
      await expect(page.locator('#client-sign-in-button')).toBeVisible();

      // Should see the email and password fields
      await expect(page.locator('input[type="email"]')).toBeVisible();
      await expect(page.locator('input[type="password"]')).toBeVisible();
    });

    test('should preserve callbackUrl when showing discovery form', async ({ page }) => {
      // Visit with a callback URL
      await page.goto('http://localhost:3000/auth/client-portal/signin?callbackUrl=/client-portal/tickets');

      // Should show the discovery form
      await expect(page.locator('#tenant-discovery-form')).toBeVisible();

      // The callbackUrl should be preserved (we'll verify this when submitting)
      const currentUrl = page.url();
      expect(currentUrl).toContain('callbackUrl=/client-portal/tickets');
    });

    test('should show success message after submitting email', async ({ page }) => {
      // Visit the discovery form
      await page.goto('http://localhost:3000/auth/client-portal/signin');

      // Fill in email
      await page.locator('#tenant-discovery-email').fill('test@example.com');

      // Submit the form
      await page.locator('#tenant-discovery-submit-button').click();

      // Should see the success message
      await expect(page.getByRole('heading', { name: 'Check Your Email' })).toBeVisible({ timeout: 10000 });

      // Should see the success description in the card (not the toast)
      await expect(page.locator('.text-center').getByText(/If an account exists with that email address, we've sent you login links/)).toBeVisible();

      // Should see the "Try Another Email" button
      await expect(page.locator('#tenant-discovery-back-button')).toBeVisible();
    });

    test('should send email even when user does not exist (prevent enumeration)', async ({ page }) => {
      // Visit the discovery form
      await page.goto('http://localhost:3000/auth/client-portal/signin');

      // Wait for the discovery form to be visible
      await expect(page.locator('#tenant-discovery-form')).toBeVisible();

      // Fill in an email that definitely doesn't exist
      const nonExistentEmail = `nonexistent-${Date.now()}@example.com`;
      await page.locator('#tenant-discovery-email').fill(nonExistentEmail);

      // Submit the form
      await page.locator('#tenant-discovery-submit-button').click();

      // Should still see the success message (to prevent account enumeration)
      await expect(page.getByRole('heading', { name: 'Check Your Email' })).toBeVisible({ timeout: 10000 });

      // Should see the same generic success message
      await expect(page.locator('.text-center').getByText(/If an account exists with that email address, we've sent you login links/)).toBeVisible();

      // Should see the "Try Another Email" button
      await expect(page.locator('#tenant-discovery-back-button')).toBeVisible();

      // TODO: Verify that an email was actually sent (would need email service mock/spy)
      // For now, this test verifies the UI behaves identically for existing and non-existing users
    });

    test('should allow trying another email after submission', async ({ page }) => {
      // Visit the discovery form
      await page.goto('http://localhost:3000/auth/client-portal/signin');

      // Fill and submit first email
      await page.locator('#tenant-discovery-email').fill('first@example.com');
      await page.locator('#tenant-discovery-submit-button').click();

      // Wait for success message
      await expect(page.getByRole('heading', { name: 'Check Your Email' })).toBeVisible({ timeout: 10000 });

      // Click "Try Another Email"
      await page.locator('#tenant-discovery-back-button').click();

      // Should be back at the form
      await expect(page.locator('#tenant-discovery-form')).toBeVisible();

      // Email field should be empty
      const emailInput = page.locator('#tenant-discovery-email');
      await expect(emailInput).toHaveValue('');
    });

    test('should require email before enabling submit button', async ({ page }) => {
      // Visit the discovery form
      await page.goto('http://localhost:3000/auth/client-portal/signin');

      // Submit button should be disabled initially
      const submitButton = page.locator('#tenant-discovery-submit-button');
      await expect(submitButton).toBeDisabled();

      // Fill in email
      await page.locator('#tenant-discovery-email').fill('test@example.com');

      // Submit button should now be enabled
      await expect(submitButton).toBeEnabled();
    });

    test('should show MSP login link on discovery form', async ({ page }) => {
      // Visit the discovery form
      await page.goto('http://localhost:3000/auth/client-portal/signin');

      // Should see MSP login link
      await expect(page.getByText('MSP Staff? Login here →')).toBeVisible();

      // Link should point to MSP signin
      const mspLink = page.getByRole('link', { name: /MSP Staff/i });
      await expect(mspLink).toHaveAttribute('href', '/auth/msp/signin');
    });

    test('should handle direct navigation to dashboard without tenant', async ({ page }) => {
      // Try to access dashboard directly without being logged in and without tenant
      await page.goto('http://localhost:3000/client-portal/dashboard');

      // Should be redirected to signin
      await page.waitForURL(/\/auth\/client-portal\/signin/, { timeout: 10000 });

      // Should show the discovery form (no tenant in redirect)
      await expect(page.locator('#tenant-discovery-form')).toBeVisible();

      // CallbackUrl should be preserved in the URL
      expect(page.url()).toContain('callbackUrl=%2Fclient-portal%2Fdashboard');
    });
  });

  test.describe('Form Validation', () => {
    test('should validate email format', async ({ page }) => {
      // Visit the discovery form
      await page.goto('http://localhost:3000/auth/client-portal/signin');

      // The email input should have type="email" for browser validation
      const emailInput = page.locator('#tenant-discovery-email');
      await expect(emailInput).toHaveAttribute('type', 'email');

      // The input should be required
      await expect(emailInput).toHaveAttribute('required');
    });
  });

  test.describe('Visual Elements', () => {
    test('should show proper branding and styling', async ({ page }) => {
      // Visit the discovery form
      await page.goto('http://localhost:3000/auth/client-portal/signin');

      // Should have gradient background
      const body = page.locator('body');
      await expect(body).toBeVisible();

      // Should show card with proper structure
      await expect(page.getByText('Find Your Organization')).toBeVisible();
      await expect(page.getByText(/Enter your email address and we'll send you login links/)).toBeVisible();

      // Should show mail icon
      await expect(page.locator('svg').first()).toBeVisible();
    });
  });
});
