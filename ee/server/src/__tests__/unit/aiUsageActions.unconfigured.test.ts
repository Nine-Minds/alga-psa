import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkAccountManagementUpdatePermission: vi.fn(),
  getSession: vi.fn(),
  isSelfHostLicensing: vi.fn(),
  getLicenseStateRow: vi.fn(),
  createAiAddonCheckoutSession: vi.fn(),
  createAiTopupCheckoutSession: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({ getSession: mocks.getSession }));
vi.mock('@alga-psa/auth/actions', () => ({
  checkAccountManagementUpdatePermission: mocks.checkAccountManagementUpdatePermission,
}));
vi.mock('@alga-psa/licensing', () => ({
  isSelfHostLicensing: mocks.isSelfHostLicensing,
  getLicenseStateRow: mocks.getLicenseStateRow,
}));
vi.mock('@alga-psa/core/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.loggerError },
}));
vi.mock('../../lib/aiGateway/checkout', () => ({
  createAiAddonCheckoutSession: mocks.createAiAddonCheckoutSession,
  createAiTopupCheckoutSession: mocks.createAiTopupCheckoutSession,
}));

const actions = await import('../../lib/actions/aiUsageActions');
const { isAiGatewayConfigured } = await import('../../lib/aiGateway/client');

const UNAVAILABLE = { status: 'unavailable', reason: 'not_configured' };

describe('AI usage actions when the AI gateway is not configured', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AI_GATEWAY_URL;
    delete process.env.AI_GATEWAY_SERVICE_SECRET;
    mocks.getSession.mockResolvedValue({ user: { tenant: 'tenant-1' } });
    mocks.checkAccountManagementUpdatePermission.mockResolvedValue(true);
    mocks.isSelfHostLicensing.mockResolvedValue(false);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns unavailable from every action without throwing or logging errors', async () => {
    await expect(actions.getAiAccountSummary()).resolves.toEqual(UNAVAILABLE);
    await expect(actions.getAiUsageHistory({})).resolves.toEqual(UNAVAILABLE);
    await expect(actions.setAiAutoTopup({ enabled: true })).resolves.toEqual(UNAVAILABLE);
    await expect(actions.startAiAddonCheckout()).resolves.toEqual(UNAVAILABLE);
    await expect(actions.startAiTopupCheckout('price_1')).resolves.toEqual(UNAVAILABLE);
    expect(mocks.createAiAddonCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.createAiTopupCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('still rejects unauthenticated callers', async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(actions.getAiAccountSummary()).rejects.toThrow('Not authenticated');
  });

  describe('isAiGatewayConfigured', () => {
    it('needs the URL and, when hosted, the service secret', async () => {
      expect(await isAiGatewayConfigured()).toBe(false);
      process.env.AI_GATEWAY_URL = 'http://gateway.test';
      expect(await isAiGatewayConfigured()).toBe(false);
      process.env.AI_GATEWAY_SERVICE_SECRET = 'secret';
      expect(await isAiGatewayConfigured()).toBe(true);
    });

    it('does not need the service secret on self-hosted installs', async () => {
      mocks.isSelfHostLicensing.mockResolvedValue(true);
      process.env.AI_GATEWAY_URL = 'http://gateway.test';
      expect(await isAiGatewayConfigured()).toBe(true);
      delete process.env.AI_GATEWAY_URL;
      expect(await isAiGatewayConfigured()).toBe(false);
    });
  });
});
