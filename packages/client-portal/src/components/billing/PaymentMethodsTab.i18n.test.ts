// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const localeRoot = path.resolve(__dirname, '../../../../../server/public/locales/en');
const readLocale = (file: string) => JSON.parse(fs.readFileSync(path.join(localeRoot, file), 'utf8'));

describe('payment methods and auto-pay locale keys', () => {
  it('defines the portal labels and confirmation messages used by the billing screens', () => {
    const portal = readLocale('client-portal.json');
    expect(portal.tabs.paymentMethods).toEqual(expect.any(String));
    expect(portal.invoice.autopayWillCharge).toEqual(expect.any(String));
    expect(portal.account.billing.cardSetup).toMatchObject({ success: expect.any(String), error: expect.any(String) });
    expect(portal.account.billing.autopay).toMatchObject({
      title: expect.any(String), loading: expect.any(String), profileUnavailable: expect.any(String),
      cardFallback: expect.any(String), enrolled: expect.any(String), disable: expect.any(String),
      consent: expect.any(String), enable: expect.any(String), noCards: expect.any(String),
    });
    expect(portal.account.billing.publicCardSetup).toMatchObject({
      saved: expect.any(String), failed: expect.any(String), savedDescription: expect.any(String), failedDescription: expect.any(String),
    });
  });

  it('defines MSP setup-link fallback and unknown-actor labels', () => {
    const clients = readLocale('msp/clients.json');
    expect(clients.clientAutopay).toMatchObject({
      setupLinkTitle: expect.any(String), setupLinkFallback: expect.any(String), unknownUser: expect.any(String),
    });
  });
});
