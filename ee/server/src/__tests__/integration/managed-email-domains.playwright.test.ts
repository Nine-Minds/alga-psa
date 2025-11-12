import { expect, test } from '@playwright/test';
import { applyPlaywrightAuthEnvDefaults, createTenantAndLogin } from './helpers/playwrightAuthSessionHelper';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';

const BASE_URL = process.env.EE_BASE_URL || 'http://localhost:3000';

applyPlaywrightAuthEnvDefaults();

const nowIso = new Date().toISOString();

const managedDomainMocks = {
  settings: {
    tenantId: 'playwright-tenant',
    customDomains: [],
    emailProvider: 'resend',
    providerConfigs: [
      {
        providerId: 'resend-managed-provider',
        providerType: 'resend',
        isEnabled: true,
        config: {
          apiKey: 'mock-playwright-key',
          from: 'ops@playwright.local',
        },
      },
    ],
    trackingEnabled: true,
    maxDailyEmails: 1500,
    createdAt: nowIso,
    updatedAt: nowIso,
  },
  initialDomains: [
    {
      domain: 'acme-mail.example',
      status: 'pending',
      providerId: 'mock-resend',
      providerDomainId: 'mock-dom-001',
      dnsRecords: [
        { type: 'TXT', name: '_amazonses.acme-mail.example', value: '"playwright-verification"' },
        { type: 'MX', name: 'acme-mail.example', value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10 },
      ],
      verifiedAt: null,
      failureReason: null,
      updatedAt: nowIso,
    },
    {
      domain: 'stale.fail.example',
      status: 'failed',
      providerId: 'mock-resend',
      providerDomainId: 'mock-dom-002',
      dnsRecords: [
        { type: 'TXT', name: '_amazonses.stale.fail.example', value: '"stale-token"' },
      ],
      verifiedAt: null,
      failureReason: 'DKIM record missing for selector default._domainkey.',
      updatedAt: nowIso,
    },
  ],
  pendingDnsRecords: [
    { type: 'TXT', name: '_amazonses.new.msp.test', value: '"new-domain"' },
    { type: 'CNAME', name: 'bounces.new.msp.test', value: 'managed.resend.com' },
  ],
  verifiedDnsRecords: [
    { type: 'CNAME', name: 'bounces.acme-mail.example', value: 'managed.resend.com' },
    {
      type: 'TXT',
      name: '_dmarc.acme-mail.example',
      value: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@acme-mail.example',
    },
  ],
  refreshScripts: {
    'acme-mail.example': [
      {
        status: 'verified',
        dnsRecords: [
          { type: 'CNAME', name: 'bounces.acme-mail.example', value: 'managed.resend.com' },
          {
            type: 'TXT',
            name: '_dmarc.acme-mail.example',
            value: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@acme-mail.example',
          },
        ],
        verifiedAt: nowIso,
      },
    ],
  },
};

test.describe('Managed Email Domain UI', () => {
  test('walks through domain lifecycle with mocked server calls', async ({ page }) => {
    test.setTimeout(120_000);
    const db = createTestDbConnection();

    try {
      await createTenantAndLogin(db, page, {
        completeOnboarding: true,
        sessionOptions: { baseUrl: BASE_URL },
      });

      await page.addInitScript(({ mocks }) => {
        // Wire Playwright-managed overrides into the generic UI override hook.
        const globalAny = window as typeof window & {
          __ALGA_MANAGED_EMAIL_OVERRIDES__?: any;
        };

        const cloneRecords = (records?: Array<any>) =>
          (records ?? []).map((record) => ({ ...record }));

        const hydrateDomain = (domain: any) => ({
          ...domain,
          dnsRecords: cloneRecords(domain.dnsRecords),
          updatedAt: domain.updatedAt ?? new Date().toISOString(),
        });

        const store: any = {
          settings: {
            ...mocks.settings,
            createdAt: mocks.settings?.createdAt ? new Date(mocks.settings.createdAt) : new Date(),
            updatedAt: mocks.settings?.updatedAt ? new Date(mocks.settings.updatedAt) : new Date(),
          },
          domains: (mocks.initialDomains || []).map(hydrateDomain),
          pendingDnsRecords: cloneRecords(mocks.pendingDnsRecords),
          verifiedDnsRecords: cloneRecords(mocks.verifiedDnsRecords),
          refreshScripts: { ...(mocks.refreshScripts || {}) },
        };

        const managedApi = {
          async getEmailSettings() {
            return {
              ...store.settings,
              createdAt: new Date(store.settings.createdAt),
              updatedAt: new Date(),
              providerConfigs: (store.settings.providerConfigs || []).map((config: any) => ({
                ...config,
                config: { ...config.config },
              })),
            };
          },
          async updateEmailSettings(updates: any) {
            store.settings = {
              ...store.settings,
              ...updates,
              providerConfigs: updates?.providerConfigs ?? store.settings.providerConfigs,
              updatedAt: new Date(),
            };
            return managedApi.getEmailSettings();
          },
          async getManagedEmailDomains() {
            return store.domains.map((domain: any) => ({
              ...domain,
              dnsRecords: cloneRecords(domain.dnsRecords),
            }));
          },
          async requestManagedEmailDomain(domainName: string, region?: string) {
            const normalized = domainName.trim().toLowerCase();
            store.domains.unshift({
              domain: normalized,
              status: 'pending',
              providerId: 'mock-resend',
              providerDomainId: `mock-${normalized}`,
              dnsRecords: cloneRecords(store.pendingDnsRecords),
              verifiedAt: null,
              failureReason: null,
              updatedAt: new Date().toISOString(),
              region: region || 'us-east-1',
            });
            return { success: true, alreadyRunning: false };
          },
          async refreshManagedEmailDomain(domainName: string) {
            const target = store.domains.find((domain: any) => domain.domain === domainName);
            if (target) {
              const scriptSteps = store.refreshScripts?.[domainName];
              const nextStep = Array.isArray(scriptSteps) ? scriptSteps.shift() : undefined;
              if (nextStep) {
                target.status = nextStep.status;
                target.failureReason = nextStep.failureReason ?? null;
                target.dnsRecords = cloneRecords(nextStep.dnsRecords) ?? target.dnsRecords;
                target.verifiedAt = nextStep.verifiedAt ?? target.verifiedAt;
              } else {
                target.status = 'verified';
                target.failureReason = null;
                target.dnsRecords = cloneRecords(store.verifiedDnsRecords);
                target.verifiedAt = new Date().toISOString();
              }
              target.updatedAt = new Date().toISOString();
            }
            return { success: true, alreadyRunning: false };
          },
          async deleteManagedEmailDomain(domainName: string) {
            store.domains = store.domains.filter((domain: any) => domain.domain !== domainName);
            return { success: true };
          },
        };

        globalAny.__ALGA_MANAGED_EMAIL_OVERRIDES__ = managedApi;
      }, { mocks: managedDomainMocks });

      const params = new URLSearchParams();
      params.set('tab', 'email');

      const targetUrl = params.toString()
        ? `${BASE_URL}/msp/settings?${params.toString()}`
        : `${BASE_URL}/msp/settings`;

      await page.goto(targetUrl, { waitUntil: 'networkidle' });

      const pendingCard = page.locator('[data-automation-id="managed-domain-card"][data-domain="acme-mail.example"]');
      await expect(pendingCard).toBeVisible();
      await expect(pendingCard.locator('[data-automation-id="managed-domain-status"]')).toHaveText(/pending/i);
      await expect(pendingCard.locator('[data-automation-id="managed-domain-dns-record"]')).toHaveCount(2);

      const refreshButton = pendingCard.locator('[data-automation-id="managed-domain-refresh"]');
      await expect(refreshButton).toBeVisible();
      await refreshButton.click();
      await expect(pendingCard.locator('[data-automation-id="managed-domain-status"]')).toHaveText(/verified/i);
      await expect(pendingCard.locator('[data-automation-id="managed-domain-refresh"]')).toHaveCount(0);

      const failedCard = page.locator('[data-automation-id="managed-domain-card"][data-domain="stale.fail.example"]');
      await expect(failedCard).toBeVisible();
      await expect(failedCard.locator('text=Failure reason')).toContainText('DKIM record missing');
      await failedCard.locator('[data-automation-id="managed-domain-remove"]').click();
      await expect(page.locator('[data-automation-id="managed-domain-card"][data-domain="stale.fail.example"]')).toHaveCount(0);

      await page.fill('#managed-domain-input', 'new.msp.test');
      await page.click('#add-managed-domain-button');
      const newCard = page.locator('[data-automation-id="managed-domain-card"][data-domain="new.msp.test"]');
      await expect(newCard).toBeVisible();
      await expect(newCard.locator('[data-automation-id="managed-domain-status"]')).toHaveText(/pending/i);
      await expect(newCard.locator('[data-automation-id="managed-domain-dns-record"]')).toHaveCount(2);
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });
});
