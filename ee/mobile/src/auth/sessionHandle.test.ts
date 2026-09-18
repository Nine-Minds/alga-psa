import { describe, expect, it } from "vitest";
import type { MobileSession } from "./AuthContext";
import { createSessionHandle, sessionIdentityKey } from "./sessionHandle";

const base: MobileSession = {
  accessToken: "token-1",
  refreshToken: "refresh-1",
  expiresAtMs: 1_000,
  tenantId: "tenant-1",
  user: { id: "user-1" },
};

describe("sessionHandle", () => {
  it("reads the latest token through the same object", () => {
    const ref = { current: base as MobileSession | null };
    const handle = createSessionHandle(ref);
    expect(handle.accessToken).toBe("token-1");

    ref.current = { ...base, accessToken: "token-2", refreshToken: "refresh-2", expiresAtMs: 2_000 };
    expect(handle.accessToken).toBe("token-2");
    expect(handle.refreshToken).toBe("refresh-2");
    expect(handle.expiresAtMs).toBe(2_000);
    expect(handle.user?.id).toBe("user-1");
  });

  it("serialises like a plain session", () => {
    const handle = createSessionHandle({ current: base });
    expect(JSON.parse(JSON.stringify(handle))).toEqual(base);
    expect({ ...handle }).toEqual(base);
  });

  it("keys identity on tenant and user, not on tokens", () => {
    expect(sessionIdentityKey(base)).toBe("tenant-1:user-1");
    expect(sessionIdentityKey({ ...base, accessToken: "other" })).toBe("tenant-1:user-1");
    expect(sessionIdentityKey({ ...base, user: { id: "user-2" } })).toBe("tenant-1:user-2");
    expect(sessionIdentityKey(null)).toBeNull();
  });
});
