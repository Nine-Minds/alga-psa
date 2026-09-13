import { describe, expect, it, vi } from 'vitest';

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }),
  },
}));

import { createWelcomeEmailContent } from '../email-activities';
import type { SendWelcomeEmailActivityInput, PortalProvisioningStatus } from '../../types/workflow-types';

const PORTAL_CONJUNCTION_CLAIM = 'work for your workspace and the Nine Minds Support Portal';

function build(portalStatus?: PortalProvisioningStatus) {
  const input: SendWelcomeEmailActivityInput = {
    tenantId: 'tenant-1',
    tenantName: 'CloudVBS',
    adminUser: {
      userId: 'user-1',
      firstName: 'Lynda',
      lastName: 'Contact',
      email: 'lynda@cloudvbs.test',
    },
    temporaryPassword: 'TempPass123!',
    productCode: 'psa',
    portalStatus,
  };
  return createWelcomeEmailContent(input);
}

describe('welcome email portal-access claims', () => {
  it('claims portal credentials when the portal user was created', () => {
    const { htmlBody, textBody } = build('created');
    expect(htmlBody).toContain(PORTAL_CONJUNCTION_CLAIM);
    expect(textBody).toContain(PORTAL_CONJUNCTION_CLAIM);
    expect(htmlBody).toContain('portal.nineminds.com');
    expect(textBody).toContain('portal.nineminds.com');
  });

  it('does not claim portal credentials when provisioning failed', () => {
    const { htmlBody, textBody } = build('failed');
    expect(htmlBody).not.toContain(PORTAL_CONJUNCTION_CLAIM);
    expect(textBody).not.toContain(PORTAL_CONJUNCTION_CLAIM);
    expect(htmlBody).toContain('work for your workspace.');
    expect(textBody).toContain('work for your workspace.');
    expect(htmlBody).not.toContain('portal.nineminds.com');
    expect(textBody).not.toContain('portal.nineminds.com');
  });

  it('keeps a usable support channel and says access is coming when provisioning failed', () => {
    const { htmlBody, textBody } = build('failed');
    // The portal link is gone, so the Need Help section must not collapse into
    // an unactionable "contact our support team" with no way to act on it.
    expect(htmlBody).toContain('still being set up');
    expect(textBody).toContain('still being set up');
    expect(htmlBody.toLowerCase()).toContain('reply to this email');
    expect(textBody.toLowerCase()).toContain('reply to this email');
  });

  it('keeps a usable support channel when provisioning was skipped', () => {
    const { htmlBody, textBody } = build('skipped');
    expect(htmlBody.toLowerCase()).toContain('reply to this email');
    expect(textBody.toLowerCase()).toContain('reply to this email');
  });

  it('does not claim portal credentials when provisioning was skipped', () => {
    const { htmlBody, textBody } = build('skipped');
    expect(htmlBody).not.toContain(PORTAL_CONJUNCTION_CLAIM);
    expect(textBody).not.toContain(PORTAL_CONJUNCTION_CLAIM);
    expect(htmlBody).not.toContain('portal.nineminds.com');
    expect(textBody).not.toContain('portal.nineminds.com');
  });

  it('is conservative by default when no portal status is supplied (resend path)', () => {
    const { htmlBody, textBody } = build(undefined);
    expect(htmlBody).not.toContain(PORTAL_CONJUNCTION_CLAIM);
    expect(textBody).not.toContain(PORTAL_CONJUNCTION_CLAIM);
    expect(htmlBody).not.toContain('portal.nineminds.com');
    expect(textBody).not.toContain('portal.nineminds.com');
  });

  it('does not claim the temporary password opens a pre-existing portal account', () => {
    const { htmlBody, textBody } = build('existing');
    expect(htmlBody).not.toContain(PORTAL_CONJUNCTION_CLAIM);
    expect(textBody).not.toContain(PORTAL_CONJUNCTION_CLAIM);
    expect(htmlBody).toContain('already exists for this email');
    expect(textBody).toContain('already exists for this email');
    expect(textBody).toContain('existing portal password');
  });
});
