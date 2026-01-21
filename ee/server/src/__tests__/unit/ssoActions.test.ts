import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAdminConnectionMock } = vi.hoisted(() => ({
  getAdminConnectionMock: vi.fn(() => {
    throw new Error("getAdminConnection should not be invoked for empty selections");
  }),
}));

vi.mock("@alga-psa/db/admin", () => ({
  getAdminConnection: getAdminConnectionMock,
}));

vi.mock("@/lib/db", () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: "test-tenant" })),
}));

vi.mock("@alga-psa/users/actions", () => ({
  getCurrentUser: vi.fn(async () => ({ user_id: "user-1", user_type: "internal" })),
}));

vi.mock("@alga-psa/auth", () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock("@/lib/analytics/posthog", () => ({
  analytics: { capture: vi.fn() },
}));

import { previewBulkSsoAssignment } from "../../lib/actions/ssoActions";

const getAdminConnection = getAdminConnectionMock;

describe("previewBulkSsoAssignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("short-circuits when no providers are selected", async () => {
    const result = await previewBulkSsoAssignment({
      providers: [],
      userIds: ["user-123"],
      mode: "link",
    });

    expect(result.summary.scannedUsers).toBe(0);
    expect(result.summary.providers).toHaveLength(0);
    expect(result.selectedUserIds).toEqual(["user-123"]);
    expect(getAdminConnection).not.toHaveBeenCalled();
  });

  it("short-circuits when no user ids are provided", async () => {
    const result = await previewBulkSsoAssignment({
      providers: ["google"],
      userIds: [],
      mode: "unlink",
    });

    expect(result.summary.scannedUsers).toBe(0);
    expect(result.selectedUserIds).toHaveLength(0);
    expect(getAdminConnection).not.toHaveBeenCalled();
  });
});
