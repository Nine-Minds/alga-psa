import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMock, templateRow } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  templateRow: { value: null as null | Record<string, string> },
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => ({})),
  tenantDb: () => ({
    table: () => ({ where: () => ({ first: async () => templateRow.value }) }),
  }),
}));

vi.mock('../system/SystemEmailService', () => ({
  getSystemEmailService: vi.fn(async () => ({ sendEmail: sendMock })),
}));

vi.mock('../emailLocaleResolver', () => ({
  resolveEmailLocale: vi.fn(async () => 'en'),
  getUserInfoForEmail: vi.fn(async () => null),
}));

import { sendTenantRecoveryEmail } from '../clientPortalTenantRecoveryEmail';

const infos = [
  { tenantId: 't-a', tenantName: 'Acme', loginUrl: 'https://app.example.com/signin?tenant=a', source: 'canonical' as const },
];

async function sentContent(templateName: 'tenant-recovery' | 'msp-tenant-recovery') {
  sendMock.mockClear();
  await sendTenantRecoveryEmail('user@example.com', infos, { templateName, locale: 'en' });
  const { subject, html, text } = sendMock.mock.calls[0][0] as { subject: string; html: string; text: string };
  return { subject, html, text };
}

describe('tenant recovery email platform branding', () => {
  const original = process.env.NEXT_PUBLIC_PLATFORM_NAME;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_PLATFORM_NAME;
    templateRow.value = null;
    sendMock.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_PLATFORM_NAME;
    else process.env.NEXT_PUBLIC_PLATFORM_NAME = original;
  });

  it('MSP emergency fallback never says "Client Portal" when the platform name is unset', async () => {
    const { subject, html, text } = await sentContent('msp-tenant-recovery');
    for (const part of [subject, html, text]) {
      expect(part).not.toContain('Client Portal');
      expect(part).toContain('AlgaPSA');
    }
  });

  it('MSP database template renders the MSP brand through {{platformName}}', async () => {
    templateRow.value = {
      subject: '{{platformName}} - Your Sign-in Links',
      html_content: '<h1>{{platformName}}</h1>',
      text_content: '{{platformName}} sign-in',
    };
    const { subject, html, text } = await sentContent('msp-tenant-recovery');
    expect(subject).toBe('AlgaPSA - Your Sign-in Links');
    expect(html).toBe('<h1>AlgaPSA</h1>');
    expect(text).toBe('AlgaPSA sign-in');
  });

  it('the client email still falls back to "Client Portal"', async () => {
    const { subject, html, text } = await sentContent('tenant-recovery');
    for (const part of [subject, html, text]) {
      expect(part).toContain('Client Portal');
    }
  });

  it('NEXT_PUBLIC_PLATFORM_NAME overrides the brand for both emails', async () => {
    process.env.NEXT_PUBLIC_PLATFORM_NAME = 'Acme Desk';
    for (const name of ['msp-tenant-recovery', 'tenant-recovery'] as const) {
      const { subject, html, text } = await sentContent(name);
      for (const part of [subject, html, text]) {
        expect(part).toContain('Acme Desk');
        expect(part).not.toContain('Client Portal');
      }
    }
  });
});
