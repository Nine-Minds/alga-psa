import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

vi.mock('../system/SystemEmailService', () => ({
  getSystemEmailService: async () => ({ sendEmail: mocks.sendEmail }),
}));

import { sendVendorSupportRequestEmail, type VendorSupportRequestData } from '../sendVendorSupportRequestEmail';

const baseData: VendorSupportRequestData = {
  tenantName: 'Emerald City MSP',
  tenantId: '11111111-2222-3333-4444-555555555555',
  userName: 'Glinda Good',
  userEmail: 'glinda@emeraldcity.oz',
  category: 'bug',
  subject: 'Invoices will not finalize',
  description: 'Finalizing an invoice spins forever and never completes.',
  edition: 'EE',
  isOnPrem: false,
  appVersion: '1.7.0',
  pageUrl: '/msp/billing',
};

describe('sendVendorSupportRequestEmail', () => {
  const originalOverride = process.env.VENDOR_SUPPORT_EMAIL;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendEmail.mockResolvedValue({ success: true, messageId: 'message-1' });
    delete process.env.VENDOR_SUPPORT_EMAIL;
  });

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env.VENDOR_SUPPORT_EMAIL;
    } else {
      process.env.VENDOR_SUPPORT_EMAIL = originalOverride;
    }
  });

  it('sends to the Nine Minds support mailbox with a prefixed subject and the user as reply-to', async () => {
    await sendVendorSupportRequestEmail(baseData);

    expect(mocks.sendEmail).toHaveBeenCalledOnce();
    const message = mocks.sendEmail.mock.calls[0][0];

    expect(message.to).toBe('support@nineminds.com');
    expect(message.subject).toBe('[Alga PSA Support] [bug] Invoices will not finalize');
    expect(message.replyTo).toBe('glinda@emeraldcity.oz');
  });

  it('strips CR/LF from the user subject to block header injection', async () => {
    await sendVendorSupportRequestEmail({
      ...baseData,
      subject: 'Broken\r\nBcc: attacker@example.test',
    });

    const message = mocks.sendEmail.mock.calls[0][0];
    expect(message.subject).toBe('[Alga PSA Support] [bug] Broken Bcc: attacker@example.test');
    expect(message.subject).not.toMatch(/[\r\n]/);
  });

  it('emits the standard submission block in order after the description', async () => {
    await sendVendorSupportRequestEmail({ ...baseData, category: 'billing', isOnPrem: true, edition: 'CE' });

    const message = mocks.sendEmail.mock.calls[0][0];
    const lines = message.text.split('\n');
    const blockStart = lines.indexOf('--- Support request ---');

    expect(message.text.startsWith(baseData.description)).toBe(true);
    expect(blockStart).toBeGreaterThan(0);
    expect(lines.slice(blockStart, blockStart + 8)).toEqual([
      '--- Support request ---',
      'Source: Alga PSA app',
      'Category: billing',
      'Tenant: Emerald City MSP (11111111-2222-3333-4444-555555555555)',
      'Submitted by: Glinda Good <glinda@emeraldcity.oz>',
      'Edition: CE, on-prem: yes',
      'App version: 1.7.0',
      'Page: /msp/billing',
    ]);
  });

  it('keeps the block field order in the HTML body and falls back to n/a without a version', async () => {
    await sendVendorSupportRequestEmail({ ...baseData, appVersion: undefined });

    const message = mocks.sendEmail.mock.calls[0][0];
    const fieldOrder = [
      '--- Support request ---',
      'Source: Alga PSA app',
      'Category: bug',
      'Tenant: Emerald City MSP',
      'Submitted by: Glinda Good',
      'Edition: EE, on-prem: no',
      'App version: n/a',
      'Page: /msp/billing',
    ];

    let cursor = -1;
    for (const field of fieldOrder) {
      const index = message.html.indexOf(field, cursor + 1);
      expect(index, `expected ${field} after position ${cursor}`).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it('escapes HTML in user-supplied values but keeps the plain text raw', async () => {
    await sendVendorSupportRequestEmail({
      ...baseData,
      tenantName: 'A&B <script>alert(1)</script>',
      userName: 'Toto <toto>',
      description: '<img src=x onerror=alert(1)> & broken',
    });

    const message = mocks.sendEmail.mock.calls[0][0];
    expect(message.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; broken');
    expect(message.html).toContain('A&amp;B &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(message.html).toContain('Toto &lt;toto&gt;');
    expect(message.html).not.toContain('<script>');
    expect(message.html).not.toContain('<img');
    expect(message.text).toContain('<img src=x onerror=alert(1)> & broken');
  });

  it('throws when the provider reports a failed send', async () => {
    mocks.sendEmail.mockResolvedValue({ success: false, error: 'SMTP 535 authentication failed' });

    await expect(sendVendorSupportRequestEmail(baseData))
      .rejects.toThrow('SMTP 535 authentication failed');
  });

  it('throws when a failed send carries no error message', async () => {
    mocks.sendEmail.mockResolvedValue({ success: false });

    await expect(sendVendorSupportRequestEmail(baseData))
      .rejects.toThrow('Failed to send vendor support request email');
  });

  it('honours the VENDOR_SUPPORT_EMAIL override for staging', async () => {
    process.env.VENDOR_SUPPORT_EMAIL = 'support@staging.example.test';

    await sendVendorSupportRequestEmail(baseData);

    expect(mocks.sendEmail.mock.calls[0][0].to).toBe('support@staging.example.test');
  });
});
