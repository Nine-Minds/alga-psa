import { describe, expect, it } from "vitest";
import { isSessionUsable, msUntilExpiry, msUntilRefresh, shouldRefreshOnResume, shouldRunRevocationCheck } from "./bootstrapUtils";

describe("bootstrapUtils", () => {
  it("treats sessions as usable only before expiry", () => {
    expect(isSessionUsable({ accessToken: "", refreshToken: "", expiresAtMs: 1000 }, 999)).toBe(true);
    expect(isSessionUsable({ accessToken: "", refreshToken: "", expiresAtMs: 1000 }, 1000)).toBe(false);
  });

  it("computes refresh and expiry delays with non-negative clamp", () => {
    expect(msUntilRefresh(1000, 0, 200)).toBe(800);
    expect(msUntilRefresh(1000, 900, 200)).toBe(0);
    expect(msUntilExpiry(1000, 0)).toBe(1000);
    expect(msUntilExpiry(1000, 1500)).toBe(0);
  });

  it("determines resume refresh and revocation throttle behavior", () => {
    expect(shouldRefreshOnResume(1000, 900, 200)).toBe(true);
    expect(shouldRefreshOnResume(1000, 700, 200)).toBe(false);

    expect(shouldRunRevocationCheck(0, 600_000, 600_000)).toBe(true);
    expect(shouldRunRevocationCheck(10_000, 600_000, 600_000)).toBe(false);
  });
});

