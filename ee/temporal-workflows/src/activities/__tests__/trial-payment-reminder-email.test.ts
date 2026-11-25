import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTrialPaymentReminderEmailContent } from '../trial-payment-reminder-email.js';

// The reminder's own lifecycle-email scaffolding. It used to be asserted
// against the welcome email's source too; the welcome email was redesigned
// (ee/docs/plans/2026-11-22-welcome-email-redesign) and the reminder was
// deliberately left as it is, so the two no longer share markup.
const REMINDER_SCAFFOLDING = [
  "family=Inter:wght@400;500;600&family=Poppins:wght@600;700",
  'background: linear-gradient(135deg, #8a4dea 0%, #a366f0 100%)',
  'class="email-container shadow"',
  'class="tagline-box"',
  '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"',
  'bgcolor="#1e293b" class="rounded-bottom"',
  'Nine Minds. All rights reserved.',
  'https://portal.nineminds.com/auth/client-portal/signin',
];

describe('createTrialPaymentReminderEmailContent', () => {
  const originalApplicationUrl = process.env.APPLICATION_URL;

  beforeEach(() => {
    process.env.APPLICATION_URL = 'https://app.algapsa.test';
  });

  afterEach(() => {
    if (originalApplicationUrl === undefined) {
      delete process.env.APPLICATION_URL;
    } else {
      process.env.APPLICATION_URL = originalApplicationUrl;
    }
  });

  it('keeps its lifecycle email scaffolding', () => {
    const { htmlBody } = createTrialPaymentReminderEmailContent({
      tenantName: 'Acme MSP',
      trialEndIso: '2026-03-14T12:00:00.000Z',
    });

    for (const marker of REMINDER_SCAFFOLDING) {
      expect(htmlBody, `reminder template is missing: ${marker}`).toContain(marker);
    }
  });

  it('states the payment date, that no action is needed, and how to cancel', () => {
    const { subject, htmlBody, textBody } = createTrialPaymentReminderEmailContent({
      tenantName: 'Acme MSP',
      trialEndIso: '2026-03-14T12:00:00.000Z',
      recipientFirstName: 'Ada',
      recipientLastName: 'Admin',
    });

    expect(subject).toBe('Your AlgaPSA trial ends soon — first payment on March 14, 2026');
    expect(htmlBody).toContain('Hello Ada Admin,');
    expect(htmlBody).toContain('March 14, 2026');
    expect(htmlBody).toContain('Action needed:');
    expect(htmlBody).toContain('https://app.algapsa.test/msp/account');
    expect(htmlBody).toContain('cancel before the trial ends');

    expect(textBody).toContain('Hello Ada Admin,');
    expect(textBody).toContain('ends on March 14, 2026');
    expect(textBody).toContain('Account Management: https://app.algapsa.test/msp/account');
    expect(textBody).toContain('Nine Minds Support Portal');
  });

  it('omits the account link when no application URL is configured', () => {
    delete process.env.APPLICATION_URL;
    const previousNextAuthUrl = process.env.NEXTAUTH_URL;
    delete process.env.NEXTAUTH_URL;

    try {
      const { htmlBody, textBody } = createTrialPaymentReminderEmailContent({
        tenantName: 'Acme MSP',
        trialEndIso: '2026-03-14T12:00:00.000Z',
      });

      expect(htmlBody).not.toContain('/msp/account');
      expect(htmlBody).toContain('Nine Minds Support Portal');
      expect(textBody).not.toContain('Account Management: ');
    } finally {
      if (previousNextAuthUrl !== undefined) {
        process.env.NEXTAUTH_URL = previousNextAuthUrl;
      }
    }
  });
});
