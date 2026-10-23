import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const autopay = {
  getProfileOverview: vi.fn(),
  enroll: vi.fn(),
  disenroll: vi.fn(),
};
const savedMethods = { startSetup: vi.fn() };
const AutopayService = { create: vi.fn(async () => autopay) };
const SavedPaymentMethodService = { create: vi.fn(async () => savedMethods) };

vi.mock('@enterprise/lib/payments', () => ({ AutopayService, SavedPaymentMethodService }));

import {
  disableBillingProfileAutopay,
  enrollBillingProfileAutopay,
  getAutopayProfileOverview,
  startSavedPaymentMethodSetup,
} from './autopayBridge';

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listSourceFiles(fullPath) : /\.(?:ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

describe('clients auto-pay bridge', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.EDITION = originalEdition;
    process.env.NEXT_PUBLIC_EDITION = originalPublicEdition;
  });

  it('is inert in community builds and never touches the EE services', async () => {
    process.env.EDITION = 'ce';
    process.env.NEXT_PUBLIC_EDITION = 'community';

    await expect(getAutopayProfileOverview('tenant-1', 'bp-1')).resolves.toBeNull();
    await expect(startSavedPaymentMethodSetup('tenant-1', 'client-1', 'bp-1', undefined, true)).resolves.toBeNull();
    await expect(enrollBillingProfileAutopay('tenant-1', 'bp-1', 'pm-1', {})).resolves.toBe(false);
    await expect(disableBillingProfileAutopay('tenant-1', 'bp-1', 'msp_request', 'user-1')).resolves.toBe(false);
    expect(AutopayService.create).not.toHaveBeenCalled();
    expect(SavedPaymentMethodService.create).not.toHaveBeenCalled();
  });

  it('delegates to the tenant-scoped EE services in enterprise builds', async () => {
    process.env.EDITION = 'ee';
    autopay.getProfileOverview.mockResolvedValue({ enabled: true });
    savedMethods.startSetup.mockResolvedValue({ url: 'https://checkout.example/setup' });
    const authorization = { userId: 'user-1', source: 'msp', consentTextVersion: 'v1' };

    await expect(getAutopayProfileOverview('tenant-1', 'bp-1')).resolves.toEqual({ enabled: true });
    await expect(startSavedPaymentMethodSetup('tenant-1', 'client-1', 'bp-1', undefined, true))
      .resolves.toEqual({ url: 'https://checkout.example/setup' });
    await expect(enrollBillingProfileAutopay('tenant-1', 'bp-1', 'pm-1', authorization)).resolves.toBe(true);
    await expect(disableBillingProfileAutopay('tenant-1', 'bp-1', 'msp_request', 'user-1')).resolves.toBe(true);

    expect(AutopayService.create).toHaveBeenCalledWith('tenant-1');
    expect(SavedPaymentMethodService.create).toHaveBeenCalledWith('tenant-1');
    expect(autopay.getProfileOverview).toHaveBeenCalledWith('bp-1');
    expect(savedMethods.startSetup).toHaveBeenCalledWith('client-1', 'bp-1', undefined, true);
    expect(autopay.enroll).toHaveBeenCalledWith('bp-1', 'pm-1', authorization);
    expect(autopay.disenroll).toHaveBeenCalledWith('bp-1', 'msp_request', 'user-1');
  });

  it('keeps the bridge module free of the use server directive', () => {
    const source = readFileSync(path.resolve(__dirname, 'autopayBridge.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*['"]use server['"]/m);
  });

  // @alga-psa/billing already reaches @alga-psa/clients (billing -> notifications -> telephony -> clients),
  // so any clients -> billing import closes a package cycle that CI's circular-deps check rejects.
  it('keeps the clients package from importing @alga-psa/billing', () => {
    const packageRoot = path.resolve(__dirname, '../..');
    const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    expect({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies }).not.toHaveProperty('@alga-psa/billing');

    const offenders = listSourceFiles(path.join(packageRoot, 'src'))
      .filter((file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'))
      .filter((file) => /from\s+['"]@alga-psa\/billing(?:\/[^'"]*)?['"]|import\(\s*['"]@alga-psa\/billing/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(packageRoot, file));
    expect(offenders).toEqual([]);
  });
});
