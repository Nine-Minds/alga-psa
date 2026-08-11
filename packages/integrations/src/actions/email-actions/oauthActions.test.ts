import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  resolveMicrosoftEmailIssuerChoice: vi.fn(),
  getAppSecret: vi.fn(),
  getTenantSecret: vi.fn(),
  getMicrosoftEmailSetupMetadataInternal: vi.fn(),
  storeMicrosoftEmailOAuthNonce: vi.fn(),
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
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({
    table: () => ({
      where: () => ({ first: async () => ({ id: "provider-1" }) }),
    }),
  }),
}));

vi.mock("../../lib/microsoftEmailIssuerSelection", () => ({
  resolveMicrosoftEmailIssuerChoice: (...args: unknown[]) =>
    mocks.resolveMicrosoftEmailIssuerChoice(...args),
  MicrosoftEmailIssuerError: class MicrosoftEmailIssuerError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = "MicrosoftEmailIssuerError";
      this.code = code;
    }
  },
  MICROSOFT_EMAIL_ISSUER_ERRORS: {
    INVALID_CHOICE: "ms_email_invalid_choice",
    PROFILE_NOT_FOUND: "ms_email_profile_not_found",
    CROSS_TENANT_PROFILE: "ms_email_cross_tenant_profile",
    INACTIVE_PROFILE: "ms_email_inactive_profile",
    MISSING_EMAIL_CAPABILITY: "ms_email_missing_email_capability",
    ISSUER_NOT_READY: "ms_email_issuer_not_ready",
    CONSENT_NOT_READY: "ms_email_consent_not_ready",
    CLIENT_MISMATCH_RECONNECT_REQUIRED: "ms_email_client_mismatch_reconnect_required",
    INVALID_STATE: "ms_email_invalid_state",
    EXPIRED_STATE: "ms_email_expired_state",
    REPLAYED_STATE: "ms_email_replayed_state",
    CALLBACK_PERSISTENCE_FAILED: "ms_email_callback_persistence_failed",
  },
}));

vi.mock("../../utils/email/microsoftEmailOAuthStateStore", () => ({
  storeMicrosoftEmailOAuthNonce: (...args: unknown[]) =>
    mocks.storeMicrosoftEmailOAuthNonce(...args),
}));

vi.mock("../integrations/microsoftActions", () => ({
  getMicrosoftEmailSetupMetadataInternal: mocks.getMicrosoftEmailSetupMetadataInternal,
}));

import { initiateEmailOAuth } from "./oauthActions";
import {
  validateMicrosoftEmailOAuthState,
} from "../../utils/email/microsoftEmailOAuthState";

const originalBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;

const managedResolution = {
  choice: { kind: "managed", clientId: "platform-client-id" },
  issuerKind: "managed" as const,
  clientId: "platform-client-id",
  clientSecret: "platform-client-secret",
  microsoftTenantId: "common",
};

const profileResolution = {
  choice: { kind: "profile", profileId: "profile-1", clientId: "tenant-client-id" },
  issuerKind: "profile" as const,
  clientId: "tenant-client-id",
  clientSecret: "tenant-client-secret",
  clientSecretRef: "microsoft_profile_profile-1_client_secret",
  microsoftTenantId: "tenant-directory-id",
  profileId: "profile-1",
};

describe("initiateEmailOAuth Microsoft explicit issuer selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.getAppSecret.mockResolvedValue(null);
    mocks.getTenantSecret.mockResolvedValue(null);
    mocks.storeMicrosoftEmailOAuthNonce.mockResolvedValue(undefined);
    mocks.getMicrosoftEmailSetupMetadataInternal.mockResolvedValue({
      mailboxRedirectUri: 'https://psa.example.com/api/auth/microsoft/callback',
    });
    process.env.NEXT_PUBLIC_BASE_URL = "https://psa.example.com";
    process.env.NEXTAUTH_SECRET = "test-state-signing-secret";
  });

  afterAll(() => {
    if (originalBaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_BASE_URL = originalBaseUrl;
    }
    if (originalNextAuthSecret === undefined) {
      delete process.env.NEXTAUTH_SECRET;
    } else {
      process.env.NEXTAUTH_SECRET = originalNextAuthSecret;
    }
  });

  it("selects the managed app and carries a signed state with the explicit choice", async () => {
    mocks.resolveMicrosoftEmailIssuerChoice.mockResolvedValue(managedResolution);

    const result = await initiateEmailOAuth({
      provider: "microsoft",
      providerId: "provider-1",
      purpose: "reconnect",
      issuer: { kind: "managed", clientId: "platform-client-id" },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.authUrl).toContain("client_id=platform-client-id");
    expect(mocks.resolveMicrosoftEmailIssuerChoice).toHaveBeenCalledWith("tenant-1", {
      kind: "managed",
      clientId: "platform-client-id",
    });
    // The state is the signed token, not plain base64 JSON.
    expect(result.state).toContain(".");
    expect(mocks.storeMicrosoftEmailOAuthNonce).toHaveBeenCalledTimes(1);

    const payload = validateMicrosoftEmailOAuthState({
      token: result.state,
      secret: process.env.NEXTAUTH_SECRET,
    });
    expect(payload).toMatchObject({
      purpose: "reconnect",
      tenant: "tenant-1",
      userId: "user-1",
      providerId: "provider-1",
      issuerKind: "managed",
      clientId: "platform-client-id",
      redirectUri: "https://psa.example.com/api/auth/microsoft/callback",
    });
    expect(result.authUrl).toContain(encodeURIComponent('https://psa.example.com/api/auth/microsoft/callback'));
    expect(result.authUrl).not.toContain('attacker.example');
  });

  it("selects an explicit tenant profile and pins its profile ID in the signed state", async () => {
    mocks.resolveMicrosoftEmailIssuerChoice.mockResolvedValue(profileResolution);

    const result = await initiateEmailOAuth({
      provider: "microsoft",
      providerId: "provider-1",
      purpose: "reconnect",
      issuer: { kind: "profile", profileId: "profile-1", clientId: "tenant-client-id" },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.authUrl).toContain("client_id=tenant-client-id");
    expect(mocks.resolveMicrosoftEmailIssuerChoice).toHaveBeenCalledWith("tenant-1", {
      kind: "profile",
      profileId: "profile-1",
      clientId: "tenant-client-id",
    });
    const payload = validateMicrosoftEmailOAuthState({
      token: result.state,
      secret: process.env.NEXTAUTH_SECRET,
    });
    expect(payload).toMatchObject({
      purpose: "reconnect",
      issuerKind: "profile",
      issuerProfileId: "profile-1",
      clientId: "tenant-client-id",
    });
  });

  it("defaults purpose to create when no provider ID is present", async () => {
    mocks.resolveMicrosoftEmailIssuerChoice.mockResolvedValue(managedResolution);

    const result = await initiateEmailOAuth({
      provider: "microsoft",
      issuer: { kind: "managed", clientId: "platform-client-id" },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const payload = validateMicrosoftEmailOAuthState({
      token: result.state,
      secret: process.env.NEXTAUTH_SECRET,
    });
    expect(payload?.purpose).toBe("create");
  });

  it("rejects a Teams-only (non-Email-capable) app with a stable error code", async () => {
    const { MicrosoftEmailIssuerError, MICROSOFT_EMAIL_ISSUER_ERRORS } = await import(
      "../../lib/microsoftEmailIssuerSelection"
    );
    mocks.resolveMicrosoftEmailIssuerChoice.mockRejectedValue(
      new MicrosoftEmailIssuerError(
        MICROSOFT_EMAIL_ISSUER_ERRORS.MISSING_EMAIL_CAPABILITY,
        "The selected Microsoft application is not enabled for Outlook email"
      )
    );

    const result = await initiateEmailOAuth({
      provider: "microsoft",
      providerId: "provider-1",
      purpose: "reconnect",
      issuer: { kind: "profile", profileId: "teams-profile", clientId: "teams-client-id" },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errorCode).toBe("ms_email_missing_email_capability");
    expect(result.error).toContain("not enabled for Outlook email");
  });
});
