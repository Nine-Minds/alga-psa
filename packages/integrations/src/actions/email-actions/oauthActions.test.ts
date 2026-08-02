import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  resolveMicrosoftConsumerProfileConfig: vi.fn(),
  getAppSecret: vi.fn(),
  getTenantSecret: vi.fn(),
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

import { initiateEmailOAuth } from "./oauthActions";

const originalBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;

describe("initiateEmailOAuth Microsoft credential source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.getAppSecret.mockResolvedValue(null);
    mocks.getTenantSecret.mockResolvedValue(null);
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
      microsoftCredentialSource: "platform",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.authUrl).toContain("client_id=platform-client-id");
    expect(mocks.resolveMicrosoftConsumerProfileConfig).toHaveBeenCalledWith(
      "tenant-1",
      "email",
      {
        credentialPreference: "platform",
      },
    );
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
      microsoftCredentialSource: "tenant",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.authUrl).toContain("client_id=tenant-client-id");
    expect(mocks.resolveMicrosoftConsumerProfileConfig).toHaveBeenCalledWith(
      "tenant-1",
      "email",
      {
        credentialPreference: "tenant",
      },
    );
  });
});
