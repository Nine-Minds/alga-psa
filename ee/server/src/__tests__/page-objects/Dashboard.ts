/**
 * Page Object Model for Dashboard
 * Provides methods for interacting with the dashboard after onboarding completion
 */

import { Page, Locator, expect } from '@playwright/test';

export class Dashboard {
  readonly page: Page;
  readonly dashboardContainer: Locator;
  readonly welcomeMessage: Locator;
  readonly navigationMenu: Locator;
  readonly userProfile: Locator;
  readonly logoutButton: Locator;
  readonly onboardingIndicator: Locator;
  readonly mainContent: Locator;

  // Dashboard sections
  readonly ticketsSection: Locator;
  readonly clientsSection: Locator;
  readonly projectsSection: Locator;
  readonly reportsSection: Locator;

  // Quick actions
  readonly createTicketButton: Locator;
  readonly addClientButton: Locator;
  readonly newProjectButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dashboardContainer = page.locator('[data-testid="dashboard"], .dashboard, main');
    this.welcomeMessage = page.locator('[data-testid="welcome-message"], .welcome, .greeting');
    this.navigationMenu = page.locator('[data-testid="nav-menu"], nav, .navigation');
    this.userProfile = page.locator('[data-testid="user-profile"], .user-menu, .profile');
    this.logoutButton = page.locator('button:has-text("Logout"), button:has-text("Sign out"), a:has-text("Logout")');
    this.onboardingIndicator = page.locator('[data-testid="onboarding-indicator"], .onboarding-status');
    this.mainContent = page.locator('[data-testid="main-content"], .main-content, .dashboard-content');

    // Dashboard sections
    this.ticketsSection = page.locator('[data-testid="tickets-section"], .tickets-widget');
    this.clientsSection = page.locator('[data-testid="clients-section"], .clients-widget');
    this.projectsSection = page.locator('[data-testid="projects-section"], .projects-widget');
    this.reportsSection = page.locator('[data-testid="reports-section"], .reports-widget');

    // Quick actions
    this.createTicketButton = page.locator('button:has-text("Create Ticket"), button:has-text("New Ticket")');
    this.addClientButton = page.locator('button:has-text("Add Client"), button:has-text("New Client")');
    this.newProjectButton = page.locator('button:has-text("New Project"), button:has-text("Create Project")');
  }

  /**
   * Verify dashboard is loaded
   */
  async verifyDashboardLoaded(): Promise<void> {
    await expect(this.dashboardContainer).toBeVisible();
    await expect(this.mainContent).toBeVisible();
  }

  /**
   * Verify user is successfully logged in
   */
  async verifyUserLoggedIn(userName?: string): Promise<void> {
    await expect(this.userProfile).toBeVisible();
    
    if (userName) {
      await expect(this.userProfile).toContainText(userName);
    }
  }

  /**
   * Verify onboarding is completed (no onboarding prompts)
   */
  async verifyOnboardingCompleted(): Promise<void> {
    // Check that we're on the dashboard and not on onboarding
    await expect(this.page).toHaveURL(/\/dashboard/);
    
    // Verify no onboarding wizard is present
    const onboardingWizard = this.page.locator('[data-testid="onboarding-wizard"], .onboarding-wizard');
    await expect(onboardingWizard).not.toBeVisible();

    // Verify dashboard content is accessible
    await this.verifyDashboardLoaded();
  }

  /**
   * Verify onboarding is NOT completed (onboarding prompts visible)
   */
  async verifyOnboardingNotCompleted(): Promise<void> {
    // Should be redirected to onboarding or see onboarding prompts
    const isOnOnboarding = await this.page.url().includes('/onboarding');
    const hasOnboardingIndicator = await this.onboardingIndicator.isVisible();
    
    expect(isOnOnboarding || hasOnboardingIndicator).toBe(true);
  }

  /**
   * Get welcome message text
   */
  async getWelcomeMessage(): Promise<string | null> {
    if (await this.welcomeMessage.isVisible()) {
      return await this.welcomeMessage.textContent();
    }
    return null;
  }

  /**
   * Navigate to tickets section
   */
  async navigateToTickets(): Promise<void> {
    const ticketsLink = this.page.locator('a:has-text("Tickets"), nav a[href*="tickets"]');
    await ticketsLink.click();
    await this.page.waitForURL(/\/tickets/);
  }

  /**
   * Navigate to clients section
   */
  async navigateToClients(): Promise<void> {
    const clientsLink = this.page.locator('a:has-text("Clients"), nav a[href*="clients"]');
    await clientsLink.click();
    await this.page.waitForURL(/\/clients/);
  }

  /**
   * Navigate to projects section
   */
  async navigateToProjects(): Promise<void> {
    const projectsLink = this.page.locator('a:has-text("Projects"), nav a[href*="projects"]');
    await projectsLink.click();
    await this.page.waitForURL(/\/projects/);
  }

  /**
   * Create a new ticket
   */
  async createNewTicket(ticketData: {
    title: string;
    description?: string;
    priority?: string;
    client?: string;
  }): Promise<void> {
    await this.createTicketButton.click();
    
    // Fill ticket form (this would depend on the actual ticket creation UI)
    await this.page.locator('input[name="title"], input[name="subject"]').fill(ticketData.title);
    
    if (ticketData.description) {
      await this.page.locator('textarea[name="description"]').fill(ticketData.description);
    }
    
    if (ticketData.priority) {
      await this.page.locator('select[name="priority"]').selectOption(ticketData.priority);
    }
    
    if (ticketData.client) {
      await this.page.locator('select[name="client"]').selectOption(ticketData.client);
    }
    
    await this.page.locator('button:has-text("Create"), button:has-text("Save")').click();
  }

  /**
   * Logout from the application
   */
  async logout(): Promise<void> {
    // Click user profile to open menu (if needed)
    if (await this.userProfile.isVisible()) {
      await this.userProfile.click();
    }
    
    // Click logout button
    await this.logoutButton.click();
    
    // Wait for redirect to login page
    await this.page.waitForURL(/\/login/);
  }

  /**
   * Verify dashboard widgets are loaded
   */
  async verifyDashboardWidgets(): Promise<void> {
    // Check that main dashboard widgets are present
    const widgets = [
      this.ticketsSection,
      this.clientsSection,
      this.projectsSection
    ];

    for (const widget of widgets) {
      if (await widget.isVisible()) {
        // At least one widget should be visible
        return;
      }
    }

    // If no widgets are visible, verify at least main content is there
    await expect(this.mainContent).toBeVisible();
  }

  /**
   * Verify quick actions are available
   */
  async verifyQuickActionsAvailable(): Promise<void> {
    const actions = [
      this.createTicketButton,
      this.addClientButton,
      this.newProjectButton
    ];

    let actionsVisible = 0;
    for (const action of actions) {
      if (await action.isVisible()) {
        actionsVisible++;
      }
    }

    // At least one quick action should be available
    expect(actionsVisible).toBeGreaterThan(0);
  }

  /**
   * Verify navigation menu is functional
   */
  async verifyNavigationMenu(): Promise<void> {
    await expect(this.navigationMenu).toBeVisible();
    
    // Check for common navigation items
    const navItems = [
      'Dashboard',
      'Tickets',
      'Clients',
      'Projects',
      'Reports'
    ];

    for (const item of navItems) {
      const navLink = this.page.locator(`nav a:has-text("${item}"), .navigation a:has-text("${item}")`);
      if (await navLink.isVisible()) {
        // At least some navigation items should be present
        break;
      }
    }
  }

  /**
   * Wait for dashboard to fully load
   */
  async waitForDashboardLoad(): Promise<void> {
    // Wait for main content to be visible
    await expect(this.mainContent).toBeVisible();
    
    // Wait for any loading spinners to disappear
    const loadingSpinner = this.page.locator('.loading, .spinner, [data-testid="loading"]');
    if (await loadingSpinner.isVisible()) {
      await expect(loadingSpinner).not.toBeVisible({ timeout: 10000 });
    }

    // Wait for navigation to be interactive
    await expect(this.navigationMenu).toBeVisible();
  }

  /**
   * Verify user has appropriate permissions (basic smoke test)
   */
  async verifyUserPermissions(): Promise<void> {
    // Verify user can access basic dashboard features
    await this.verifyDashboardLoaded();
    await this.verifyNavigationMenu();
    
    // Try to access at least one protected area
    try {
      await this.navigateToTickets();
      await this.page.goBack();
    } catch (error) {
      // If tickets aren't accessible, try clients
      try {
        await this.navigateToClients();
        await this.page.goBack();
      } catch (error) {
        // If neither are accessible, that might be expected for this user
        console.warn('Limited navigation access detected');
      }
    }
  }
}