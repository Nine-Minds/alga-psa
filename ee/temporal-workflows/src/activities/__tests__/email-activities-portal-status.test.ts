import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }),
  },
}));

import { createWelcomeEmailContent } from '../email-activities';
import type { SendWelcomeEmailActivityInput, PortalProvisioningStatus } from '../../types/workflow-types';

const PORTAL_URL = 'portal.nineminds.com';
const ROBERT_SENTENCE = "Once you're in, an onboarding wizard will get you up and running.";
const CREATED_CLAIM = 'The same email and temporary password work there.';
const FORBIDDEN_COLOURS = ['#40cff9', '#f0fbff', '#bae6fd', '#0284c7', '#f59e0b', '#fffbeb', '#92400e'];
const EMOJI = /\p{Extended_Pictographic}/u;

function build(portalStatus?: PortalProvisioningStatus, productCode: 'psa' | 'algadesk' = 'psa') {
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
    productCode,
    portalStatus,
  };
  return createWelcomeEmailContent(input);
}

const count = (haystack: string, needle: string | RegExp) =>
  typeof needle === 'string' ? haystack.split(needle).length - 1 : (haystack.match(needle) ?? []).length;

const STATUSES: Array<PortalProvisioningStatus | undefined> = ['created', 'existing', 'failed', 'skipped', undefined];

beforeEach(() => {
  vi.stubEnv('APPLICATION_URL', 'https://algapsa.example.test');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('welcome email portal-access claims', () => {
  it('claims the shared credentials and links the portal when the portal user was created', () => {
    const { htmlBody, textBody } = build('created');
    for (const body of [htmlBody, textBody]) {
      expect(body).toContain(CREATED_CLAIM);
      expect(body).toContain(PORTAL_URL);
    }
  });

  it('says portal access is still being set up, and that a reply reaches us, when provisioning failed', () => {
    const { htmlBody, textBody } = build('failed');
    for (const body of [htmlBody, textBody]) {
      expect(body).toContain('still being set up');
      expect(body).toContain('reply to this email and it will reach us');
      expect(body).not.toContain(CREATED_CLAIM);
      expect(body).not.toContain(PORTAL_URL);
    }
  });

  it.each(['skipped', undefined] as const)('makes no portal claim and offers the reply channel when status is %s', (status) => {
    const { htmlBody, textBody } = build(status);
    for (const body of [htmlBody, textBody]) {
      expect(body).toContain('reply to this email and it will reach us');
      expect(body).not.toContain(CREATED_CLAIM);
      expect(body).not.toContain(PORTAL_URL);
      expect(body).not.toContain('still being set up');
    }
    // The workspace credentials are still delivered.
    expect(htmlBody).toContain('TempPass123!');
    expect(textBody).toContain('TempPass123!');
  });

  it('does not claim the temporary password opens a pre-existing portal account', () => {
    const { htmlBody, textBody } = build('existing');
    for (const body of [htmlBody, textBody]) {
      expect(body).not.toContain(CREATED_CLAIM);
      expect(body).not.toMatch(/temporary password work/i);
      expect(body).toContain('existing portal password');
      expect(body).toContain('reset it');
      expect(body).toContain(PORTAL_URL);
    }
  });
});

describe('welcome email content', () => {
  it.each(STATUSES)('keeps the approved opening sentence verbatim in both bodies (%s)', (status) => {
    const { htmlBody, textBody } = build(status);
    expect(htmlBody).toContain(ROBERT_SENTENCE);
    expect(textBody).toContain(ROBERT_SENTENCE);
  });

  it.each(STATUSES)('has no spaced product name, "tenant", emoji or off-palette colours (%s)', (status) => {
    for (const productCode of ['psa', 'algadesk'] as const) {
      const { subject, htmlBody, textBody, senderName } = build(status, productCode);
      for (const text of [subject, htmlBody, textBody, senderName]) {
        expect(text).not.toMatch(/Alga PSA|Alga Desk|ALGA ?PSA|ALGA ?DESK/);
        expect(text.toLowerCase()).not.toContain('tenant');
        expect(text).not.toMatch(EMOJI);
        for (const colour of FORBIDDEN_COLOURS) expect(text.toLowerCase()).not.toContain(colour);
      }
      expect(htmlBody).not.toContain('gradient');
      expect(htmlBody).not.toContain('border-left');
    }
  });

  it('uses the approved subject and a one-word sender name', () => {
    const psa = build('created');
    expect(psa.subject).toBe('Your AlgaPSA account is ready');
    expect(psa.senderName).toBe('AlgaPSA');
    expect(psa.replyTo).toBe('support@nineminds.com');
  });

  it.each(STATUSES)('renders exactly one primary button (%s)', (status) => {
    const { htmlBody } = build(status);
    expect(count(htmlBody, 'class="primary-button"')).toBe(1);
    expect(count(htmlBody, '<v:roundrect')).toBe(1);
    expect(htmlBody).toContain('Sign in to AlgaPSA');
  });

  it('puts the same content in both bodies, in the same order', () => {
    const { htmlBody, textBody } = build('created');
    const order = [
      'Hi Lynda,',
      'CloudVBS is set up on AlgaPSA and ready when you are.',
      'lynda@cloudvbs.test',
      'TempPass123!',
      "You'll pick your own password first.",
      ROBERT_SENTENCE,
      'Your company',
      'Ticketing',
      'If you get stuck',
      'The Nine Minds team',
      'Sent because an AlgaPSA account was created for CloudVBS with this address.',
    ];
    for (const body of [htmlBody, textBody]) {
      let from = 0;
      for (const piece of order) {
        const at = body.indexOf(piece, from);
        expect(at, `${piece} should follow the previous piece`).toBeGreaterThanOrEqual(from);
        from = at;
      }
    }
  });

  it('escapes customer-supplied values in the HTML body only', () => {
    const { htmlBody, textBody } = createWelcomeEmailContent({
      tenantId: 't',
      tenantName: 'A&B <Co>',
      adminUser: { userId: 'u', firstName: 'Lynda', lastName: 'C', email: 'l@example.test' },
      temporaryPassword: 'a&b<c',
    });
    expect(htmlBody).toContain('A&amp;B &lt;Co&gt;');
    expect(htmlBody).toContain('a&amp;b&lt;c');
    expect(textBody).toContain('A&B <Co>');
  });

  it('builds a table stepper with a numbered, labelled column per PSA step', () => {
    const { htmlBody, textBody } = build('created');
    for (const [i, label] of ['Your company', 'Your team', 'First client', 'Their contact', 'Billing', 'Ticketing'].entries()) {
      expect(htmlBody).toContain(`>${i + 1}</td>`);
      expect(htmlBody).toContain(`>${label}</p>`);
      expect(textBody).toContain(`${i + 1}. ${label}`);
    }
  });

  it('gives AlgaDesk its own name and its own setup steps', () => {
    const { subject, htmlBody, textBody, senderName } = build('created', 'algadesk');
    expect(subject).toBe('Your AlgaDesk account is ready');
    expect(senderName).toBe('AlgaDesk');
    for (const body of [htmlBody, textBody]) {
      expect(body).toContain('CloudVBS is set up on AlgaDesk');
      expect(body).not.toContain('AlgaPSA');
      expect(body).not.toContain('Billing');
      expect(body).toContain('Workspace');
      expect(body).toContain('Ticketing');
    }
    expect(htmlBody).toContain('Sign in to AlgaDesk');
    expect(textBody).toContain('5. Ticketing');
    expect(textBody).not.toContain('6.');
  });

  it('shows only the product name in the top bar when no hosted logo URL can be derived', () => {
    vi.stubEnv('APPLICATION_URL', '');
    vi.stubEnv('NEXTAUTH_URL', '');
    const { htmlBody } = build('created');
    expect(htmlBody).not.toContain('<img');
    vi.stubEnv('APPLICATION_URL', 'https://algapsa.example.test/');
    expect(build('created').htmlBody).toContain('src="https://algapsa.example.test/images/avatar-purple-big.png"');
  });
});
