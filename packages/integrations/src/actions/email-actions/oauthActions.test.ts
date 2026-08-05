import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  resolveMicrosoftConsumerProfileConfig: vi.fn(),
  getAppSecret: vi.fn(),
  getTenantSecret: vi.fn(),
  getMicrosoftEmailSetupMetadataInternal: vi.fn(),
}));

vi.mock("@alga-psa/auth", () => ({
  withAuth:
    (fn: any) =>
    async (...args: any[]) =>
      fn({ user_id: "user-1" }, { tenant: "tenant-1" }, ...args),
}));

vi.mock("@alga-psa/auth/rbac", () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock("@alga-psa/core/secrets", () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: mocks.getAppSecret,
    getTenantSecret: mocks.getTenantSecret,
  }),
}));

vi.mock("@alga-psa/db", () => ({
  createTenantKnex: vi.fn(),
  tenantDb: vi.fn(),
}));

vi.mock("../../lib/microsoftConsumerProfileResolution", () => ({
  resolveMicrosoftConsumerProfileConfig: (...args: unknown[]) =>
    mocks.resolveMicrosoftConsumerProfileConfig(...args),
}));

vi.mock("../integrations/microsoftActions", () => ({
  getMicrosoftEmailSetupMetadataInternal: mocks.getMicrosoftEmailSetupMetadataInternal,
}));

import { initiateEmailOAuth } from "./oauthActions";

const originalBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;

describe("initiateEmailOAuth Microsoft credential source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.getAppSecret.mockResolvedValue(null);
    mocks.getTenantSecret.mockResolvedValue(null);
    mocks.getMicrosoftEmailSetupMetadataInternal.mockResolvedValue({
      mailboxRedirectUri: 'https://psa.example.com/api/auth/microsoft/callback',
    });
    process.env.NEXT_PUBLIC_BASE_URL = "https://psa.example.com";
  });

  afterAll(() => {
    if (originalBaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_BASE_URL = originalBaseUrl;
    }
  });

  it("initiates platform OAuth without tenant-owned app credentials", async () => {
    mocks.resolveMicrosoftConsumerProfileConfig.mockResolvedValue({
      status: "ready",
      tenantId: "tenant-1",
      consumerType: "email",
      credentialSource: "app",
      clientId: "platform-client-id",
      clientSecret: "platform-client-secret",
      microsoftTenantId: "common",
    });

    const result = await initiateEmailOAuth({
      provider: "microsoft",
      redirectUri: "https://attacker.example/callback",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.authUrl).toContain("client_id=platform-client-id");
    expect(mocks.resolveMicrosoftConsumerProfileConfig).toHaveBeenCalledWith("tenant-1", "email", {
      credentialPreference: "tenant",
    });
    expect(result.authUrl).toContain(encodeURIComponent('https://psa.example.com/api/auth/microsoft/callback'));
    expect(result.authUrl).not.toContain('attacker.example');
    expect(
      JSON.parse(Buffer.from(result.state, "base64").toString("utf8")),
    ).toMatchObject({
      tenant: "tenant-1",
      microsoftCredentialSource: "platform",
      hosted: true,
    });
  });

  it("keeps an explicit tenant app authoritative for OAuth", async () => {
    mocks.resolveMicrosoftConsumerProfileConfig.mockResolvedValue({
      status: "ready",
      tenantId: "tenant-1",
      consumerType: "email",
      credentialSource: "binding",
      profileId: "profile-1",
      clientId: "tenant-client-id",
      clientSecret: "tenant-client-secret",
      microsoftTenantId: "tenant-directory-id",
    });

    const result = await initiateEmailOAuth({
      provider: "microsoft",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.authUrl).toContain("client_id=tenant-client-id");
    expect(mocks.resolveMicrosoftConsumerProfileConfig).toHaveBeenCalledWith("tenant-1", "email", {
      credentialPreference: "tenant",
    });
  });
});
