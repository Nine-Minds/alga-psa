import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  edition: { enterprise: false },
  isSelfHostLicensing: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@alga-psa/core/features', () => ({
  get isEnterprise() {
    return mocks.edition.enterprise;
  },
}));

vi.mock('@alga-psa/licensing', () => ({
  isSelfHostLicensing: mocks.isSelfHostLicensing,
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: vi.fn(async () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  })),
}));

const { default: LicensePurchaseLayout } = await import(
  'server/src/app/msp/licenses/purchase/layout'
);

describe('License purchase layout edition routing', () => {
  beforeEach(() => {
    mocks.edition.enterprise = false;
    mocks.isSelfHostLicensing.mockReset();
    mocks.redirect.mockReset();
  });

  it('lets Community Edition render its upgrade prompt even on self-host installs', async () => {
    mocks.isSelfHostLicensing.mockResolvedValue(true);
    const child = <div>CE purchase prompt</div>;

    const result = await LicensePurchaseLayout({ children: child });

    expect(result).toBe(child);
    expect(mocks.isSelfHostLicensing).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('keeps licensed self-host Enterprise installs on the licensing portal flow', async () => {
    mocks.edition.enterprise = true;
    mocks.isSelfHostLicensing.mockResolvedValue(true);

    await LicensePurchaseLayout({ children: <div>Hosted checkout</div> });

    expect(mocks.isSelfHostLicensing).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith('https://portal.nineminds.com');
  });
});
