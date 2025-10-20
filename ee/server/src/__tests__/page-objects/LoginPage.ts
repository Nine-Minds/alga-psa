/**
 * Page Object Model for Login Page
 * Provides methods for interacting with the login page during integration tests
 */

import { Page, Locator, expect } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly errorMessage: Locator;
  readonly forgotPasswordLink: Locator;
  readonly rememberMeCheckbox: Locator;

  constructor(page: Page) {
    this.page = page;
    // MSP login form selectors (main login form)
    this.emailInput = page.locator('input[id="msp-email-field"], input[type="email"]').first();
    this.passwordInput = page.locator('input[id="msp-password-field"], input[type="password"]').first();
    this.loginButton = page.locator('button[id="msp-sign-in-button"], button[type="submit"]').first();
    this.errorMessage = page.locator('[data-testid="error-message"], .error-message, .alert-error');
    this.forgotPasswordLink = page.locator('a[data-automation-id="msp-forgot-password-link"], a:has-text("Forgot")');
    this.rememberMeCheckbox = page.locator('input[name="remember"], input[type="checkbox"]');
  }

  /**
   * Navigate to the login page (or root path for Alga PSA)
   */
  async goto(loginPath: string = '/'): Promise<void> {
    // For Alga PSA, we navigate to root path by default
    await this.page.goto(loginPath);
  }

  /**
   * Navigate to a specific login URL if needed
   */
  async gotoLoginUrl(loginPath: string = '/login'): Promise<void> {
    await this.page.goto(loginPath);
  }

  /**
   * Fill login credentials
   */
  async fillCredentials(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
  }

  /**
   * Submit login form
   */
  async submitLogin(): Promise<void> {
    await this.loginButton.click();
  }

  /**
   * Perform complete login flow
   */
  async login(email: string, password: string): Promise<void> {
    await this.fillCredentials(email, password);
    await this.submitLogin();
  }

  /**
   * Login and wait for navigation
   */
  async loginAndWaitForNavigation(email: string, password: string, expectedUrl?: string): Promise<void> {
    await this.login(email, password);
    
    if (expectedUrl) {
      await this.page.waitForURL(expectedUrl);
    } else {
      // Wait for navigation away from login page
      await this.page.waitForURL(url => !url.toString().includes('/login'));
    }
  }

  /**
   * Check if login form is visible
   */
  async isLoginFormVisible(): Promise<boolean> {
    return await this.emailInput.isVisible() && await this.passwordInput.isVisible();
  }

  /**
   * Get error message text
   */
  async getErrorMessage(): Promise<string | null> {
    if (await this.errorMessage.isVisible()) {
      return await this.errorMessage.textContent();
    }
    return null;
  }

  /**
   * Verify login page is loaded
   */
  async verifyLoginPageLoaded(): Promise<void> {
    await expect(this.emailInput).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
    await expect(this.loginButton).toBeVisible();
  }

  /**
   * Verify login error is displayed
   */
  async verifyLoginError(expectedMessage?: string): Promise<void> {
    await expect(this.errorMessage).toBeVisible();
    
    if (expectedMessage) {
      await expect(this.errorMessage).toContainText(expectedMessage);
    }
  }

  /**
   * Verify successful login redirect
   */
  async verifySuccessfulLogin(expectedPath: string = '/dashboard'): Promise<void> {
    await this.page.waitForURL(url => url.toString().includes(expectedPath), { timeout: 10000 });
    await expect(this.page).toHaveURL(new RegExp(expectedPath));
  }

  /**
   * Clear login form
   */
  async clearForm(): Promise<void> {
    await this.emailInput.clear();
    await this.passwordInput.clear();
  }

  /**
   * Check if remember me option is available
   */
  async hasRememberMeOption(): Promise<boolean> {
    return await this.rememberMeCheckbox.isVisible();
  }

  /**
   * Toggle remember me checkbox
   */
  async toggleRememberMe(check: boolean = true): Promise<void> {
    if (await this.hasRememberMeOption()) {
      if (check) {
        await this.rememberMeCheckbox.check();
      } else {
        await this.rememberMeCheckbox.uncheck();
      }
    }
  }

  /**
   * Click forgot password link
   */
  async clickForgotPassword(): Promise<void> {
    await this.forgotPasswordLink.click();
  }

  /**
   * Verify login form validation
   */
  async verifyFormValidation(): Promise<void> {
    // Try to submit empty form
    await this.submitLogin();
    
    // Check for validation messages
    const emailValidation = this.page.locator('input[name="email"]:invalid, input[type="email"]:invalid');
    const passwordValidation = this.page.locator('input[name="password"]:invalid, input[type="password"]:invalid');
    
    await expect(emailValidation.or(passwordValidation)).toBeVisible();
  }
}
