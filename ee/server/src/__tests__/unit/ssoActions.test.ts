import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAdminConnectionMock } = vi.hoisted(() => ({
  getAdminConnectionMock: vi.fn(() => {
    throw new Error("getAdminConnection should not be invoked for empty selections");
  }),
}));

vi.mock("../../../../shared/db/admin", () => ({
  getAdminConnection: getAdminConnectionMock,
}));

vi.mock("@shared/db/admin", () => ({
  getAdminConnection: getAdminConnectionMock,
}));

vi.mock("@/lib/db", () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: "test-tenant" })),
}));

vi.mock("@/lib/actions/user-actions/userActions", () => ({
  getCurrentUser: vi.fn(async () => ({ user_id: "user-1", user_type: "internal" })),
}));

vi.mock("@/lib/auth/rbac", () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock("@/lib/analytics/posthog", () => ({
  analytics: { capture: vi.fn() },
}));

import { previewBulkSsoAssignment } from "../../lib/actions/ssoActions";
import { getAdminConnection } from "../../../../shared/db/admin";

describe("previewBulkSsoAssignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("short-circuits when no providers are selected", async () => {
    const result = await previewBulkSsoAssignment({
      providers: [],
      domains: ["example.com"],
      userType: "internal",
    });

    expect(result.summary.scannedUsers).toBe(0);
    expect(result.summary.providers).toHaveLength(0);
    expect(result.normalizedDomains).toHaveLength(1);
    expect(getAdminConnection).not.toHaveBeenCalled();
  });

  it("short-circuits when domains are empty after normalization", async () => {
    const result = await previewBulkSsoAssignment({
      providers: ["google"],
      domains: ["   ", "\n"],
      userType: "internal",
    });

    expect(result.summary.scannedUsers).toBe(0);
    expect(result.normalizedDomains).toHaveLength(0);
    expect(getAdminConnection).not.toHaveBeenCalled();
  });
});
