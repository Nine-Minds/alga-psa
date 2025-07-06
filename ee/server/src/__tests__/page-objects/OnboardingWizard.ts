/**
 * Page Object Model for Onboarding Wizard
 * Provides methods for interacting with the onboarding wizard during integration tests
 */

import { Page, Locator, expect } from '@playwright/test';

export class OnboardingWizard {
  readonly page: Page;
  readonly wizardContainer: Locator;
  readonly progressIndicator: Locator;
  readonly currentStepTitle: Locator;
  readonly nextButton: Locator;
  readonly backButton: Locator;
  readonly skipButton: Locator;
  readonly finishButton: Locator;

  // Step-specific locators
  readonly companyInfoForm: Locator;
  readonly teamMembersForm: Locator;
  readonly clientForm: Locator;
  readonly contactForm: Locator;
  readonly billingForm: Locator;
  readonly ticketingForm: Locator;

  constructor(page: Page) {
    this.page = page;
    this.wizardContainer = page.locator('[data-testid="onboarding-wizard"], .onboarding-wizard');
    this.progressIndicator = page.locator('[data-testid="progress-indicator"], .progress-indicator');
    this.currentStepTitle = page.locator('[data-testid="step-title"], .step-title, h1, h2');
    this.nextButton = page.locator('button:has-text("Next"), button:has-text("Continue")');
    this.backButton = page.locator('button:has-text("Back"), button:has-text("Previous")');
    this.skipButton = page.locator('button:has-text("Skip")');
    this.finishButton = page.locator('button:has-text("Finish"), button:has-text("Complete")');

    // Step-specific forms
    this.companyInfoForm = page.locator('[data-testid="company-info-form"], .company-info-step');
    this.teamMembersForm = page.locator('[data-testid="team-members-form"], .team-members-step');
    this.clientForm = page.locator('[data-testid="client-form"], .client-step');
    this.contactForm = page.locator('[data-testid="contact-form"], .contact-step');
    this.billingForm = page.locator('[data-testid="billing-form"], .billing-step');
    this.ticketingForm = page.locator('[data-testid="ticketing-form"], .ticketing-step');
  }

  /**
   * Verify onboarding wizard is loaded
   */
  async verifyWizardLoaded(): Promise<void> {
    await expect(this.wizardContainer).toBeVisible();
    await expect(this.currentStepTitle).toBeVisible();
  }

  /**
   * Get current step number from progress indicator
   */
  async getCurrentStep(): Promise<number> {
    const progressText = await this.progressIndicator.textContent();
    const match = progressText?.match(/(\d+)\s*(?:of|\/)\s*\d+/);
    return match ? parseInt(match[1]) : 1;
  }

  /**
   * Get total number of steps
   */
  async getTotalSteps(): Promise<number> {
    const progressText = await this.progressIndicator.textContent();
    const match = progressText?.match(/\d+\s*(?:of|\/)\s*(\d+)/);
    return match ? parseInt(match[1]) : 6; // Default to 6 steps
  }

  /**
   * Get current step title
   */
  async getCurrentStepTitle(): Promise<string> {
    return await this.currentStepTitle.textContent() || '';
  }

  /**
   * Click next button
   */
  async clickNext(): Promise<void> {
    await this.nextButton.click();
  }

  /**
   * Click back button
   */
  async clickBack(): Promise<void> {
    await this.backButton.click();
  }

  /**
   * Click skip button
   */
  async clickSkip(): Promise<void> {
    await this.skipButton.click();
  }

  /**
   * Click finish button
   */
  async clickFinish(): Promise<void> {
    await this.finishButton.click();
  }

  /**
   * Complete Company Info step (Step 1)
   */
  async completeCompanyInfoStep(data: {
    companyName?: string;
    industry?: string;
    size?: string;
    address?: string;
  } = {}): Promise<void> {
    await expect(this.companyInfoForm).toBeVisible();

    if (data.companyName) {
      await this.page.locator('input[name="companyName"], input[name="company_name"]').fill(data.companyName);
    }

    if (data.industry) {
      await this.page.locator('select[name="industry"], input[name="industry"]').fill(data.industry);
    }

    if (data.size) {
      await this.page.locator('select[name="size"], select[name="company_size"]').selectOption(data.size);
    }

    if (data.address) {
      await this.page.locator('input[name="address"], textarea[name="address"]').fill(data.address);
    }

    await this.clickNext();
  }

  /**
   * Complete Team Members step (Step 2)
   */
  async completeTeamMembersStep(members: Array<{
    name: string;
    email: string;
    role?: string;
  }> = []): Promise<void> {
    await expect(this.teamMembersForm).toBeVisible();

    for (const member of members) {
      // Click add member button
      await this.page.locator('button:has-text("Add"), button:has-text("Invite")').click();

      // Fill member details
      await this.page.locator('input[name="memberName"], input[name="name"]').last().fill(member.name);
      await this.page.locator('input[name="memberEmail"], input[name="email"]').last().fill(member.email);
      
      if (member.role) {
        await this.page.locator('select[name="memberRole"], select[name="role"]').last().selectOption(member.role);
      }
    }

    await this.clickNext();
  }

  /**
   * Complete Add Client step (Step 3)
   */
  async completeAddClientStep(data: {
    clientName?: string;
    clientType?: string;
    description?: string;
  } = {}): Promise<void> {
    await expect(this.clientForm).toBeVisible();

    if (data.clientName) {
      await this.page.locator('input[name="clientName"], input[name="client_name"]').fill(data.clientName);
    }

    if (data.clientType) {
      await this.page.locator('select[name="clientType"], select[name="client_type"]').selectOption(data.clientType);
    }

    if (data.description) {
      await this.page.locator('textarea[name="description"]').fill(data.description);
    }

    await this.clickNext();
  }

  /**
   * Complete Client Contact step (Step 4)
   */
  async completeClientContactStep(data: {
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    contactRole?: string;
  } = {}): Promise<void> {
    await expect(this.contactForm).toBeVisible();

    if (data.contactName) {
      await this.page.locator('input[name="contactName"], input[name="contact_name"]').fill(data.contactName);
    }

    if (data.contactEmail) {
      await this.page.locator('input[name="contactEmail"], input[name="contact_email"]').fill(data.contactEmail);
    }

    if (data.contactPhone) {
      await this.page.locator('input[name="contactPhone"], input[name="contact_phone"]').fill(data.contactPhone);
    }

    if (data.contactRole) {
      await this.page.locator('input[name="contactRole"], input[name="contact_role"]').fill(data.contactRole);
    }

    await this.clickNext();
  }

  /**
   * Complete Billing Setup step (Step 5)
   */
  async completeBillingSetupStep(data: {
    billingType?: string;
    hourlyRate?: string;
    paymentTerms?: string;
  } = {}): Promise<void> {
    await expect(this.billingForm).toBeVisible();

    if (data.billingType) {
      await this.page.locator('select[name="billingType"], select[name="billing_type"]').selectOption(data.billingType);
    }

    if (data.hourlyRate) {
      await this.page.locator('input[name="hourlyRate"], input[name="hourly_rate"]').fill(data.hourlyRate);
    }

    if (data.paymentTerms) {
      await this.page.locator('select[name="paymentTerms"], select[name="payment_terms"]').selectOption(data.paymentTerms);
    }

    await this.clickNext();
  }

  /**
   * Complete Ticketing Configuration step (Step 6)
   */
  async completeTicketingConfigStep(data: {
    ticketTypes?: string[];
    priorities?: string[];
    defaultAssignee?: string;
  } = {}): Promise<void> {
    await expect(this.ticketingForm).toBeVisible();

    if (data.ticketTypes) {
      for (const ticketType of data.ticketTypes) {
        await this.page.locator(`input[value="${ticketType}"], label:has-text("${ticketType}") input`).check();
      }
    }

    if (data.priorities) {
      for (const priority of data.priorities) {
        await this.page.locator(`input[value="${priority}"], label:has-text("${priority}") input`).check();
      }
    }

    if (data.defaultAssignee) {
      await this.page.locator('select[name="defaultAssignee"], select[name="default_assignee"]').selectOption(data.defaultAssignee);
    }

    await this.clickFinish();
  }

  /**
   * Complete entire onboarding wizard with default data
   */
  async completeOnboardingFlow(data: {
    companyName?: string;
    skipOptionalSteps?: boolean;
  } = {}): Promise<void> {
    const { companyName = 'Test Company', skipOptionalSteps = false } = data;

    // Step 1: Company Info (Required)
    await this.completeCompanyInfoStep({ companyName });

    // Step 2: Team Members (Optional)
    if (skipOptionalSteps) {
      await this.clickSkip();
    } else {
      await this.completeTeamMembersStep([]);
    }

    // Step 3: Add Client (Optional)
    if (skipOptionalSteps) {
      await this.clickSkip();
    } else {
      await this.completeAddClientStep({ clientName: 'Test Client' });
    }

    // Step 4: Client Contact (Optional)
    if (skipOptionalSteps) {
      await this.clickSkip();
    } else {
      await this.completeClientContactStep({ 
        contactName: 'John Doe',
        contactEmail: 'john@testclient.com'
      });
    }

    // Step 5: Billing Setup (Optional)
    if (skipOptionalSteps) {
      await this.clickSkip();
    } else {
      await this.completeBillingSetupStep({ billingType: 'hourly', hourlyRate: '100' });
    }

    // Step 6: Ticketing Configuration (Required)
    await this.completeTicketingConfigStep({
      ticketTypes: ['Support', 'Bug'],
      priorities: ['High', 'Medium', 'Low']
    });
  }

  /**
   * Verify onboarding completion
   */
  async verifyOnboardingComplete(): Promise<void> {
    // Wait for redirect to dashboard or completion page
    await this.page.waitForURL(url => 
      url.toString().includes('/dashboard') || 
      url.toString().includes('/complete') || 
      !url.toString().includes('/onboarding')
    );
  }

  /**
   * Verify specific step is visible
   */
  async verifyStepVisible(stepNumber: number): Promise<void> {
    const currentStep = await this.getCurrentStep();
    expect(currentStep).toBe(stepNumber);
  }

  /**
   * Navigate to specific step (if supported)
   */
  async navigateToStep(stepNumber: number): Promise<void> {
    const stepIndicator = this.page.locator(`[data-step="${stepNumber}"], .step-${stepNumber}`);
    if (await stepIndicator.isVisible()) {
      await stepIndicator.click();
    } else {
      // Navigate through steps
      const currentStep = await this.getCurrentStep();
      const diff = stepNumber - currentStep;
      
      if (diff > 0) {
        for (let i = 0; i < diff; i++) {
          await this.clickNext();
        }
      } else if (diff < 0) {
        for (let i = 0; i < Math.abs(diff); i++) {
          await this.clickBack();
        }
      }
    }
  }
}