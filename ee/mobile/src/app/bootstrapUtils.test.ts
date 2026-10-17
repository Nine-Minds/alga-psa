import { describe, expect, it } from "vitest";
import {
  isSessionUsable,
  msUntilExpiry,
  msUntilRefresh,
  shouldRefreshOnResume,
  skipRestoredNavState,
} from "./bootstrapUtils";

describe("bootstrapUtils", () => {
  it("treats sessions as usable when refresh token exists", () => {
    expect(isSessionUsable({ accessToken: "", refreshToken: "tok", expiresAtMs: 1000 })).toBe(true);
    expect(isSessionUsable({ accessToken: "", refreshToken: "", expiresAtMs: 1000 })).toBe(false);
  });

  it("computes refresh and expiry delays with non-negative clamp", () => {
    expect(msUntilRefresh(1000, 0, 200)).toBe(800);
    expect(msUntilRefresh(1000, 900, 200)).toBe(0);
    expect(msUntilExpiry(1000, 0)).toBe(1000);
    expect(msUntilExpiry(1000, 1500)).toBe(0);
  });

  it("refreshes on resume only when the token is near expiry", () => {
    expect(shouldRefreshOnResume(1000, 900, 200)).toBe(true);
    expect(shouldRefreshOnResume(1000, 700, 200)).toBe(false);
  });

  it("T130 skips the restored route after a sign-in and for a pending deep link", () => {
    expect(skipRestoredNavState({ freshSignIn: true, pendingDeepLink: false })).toBe(true);
    expect(skipRestoredNavState({ freshSignIn: false, pendingDeepLink: true })).toBe(true);
    // A relaunch of an existing session still lands on the last screen.
    expect(skipRestoredNavState({ freshSignIn: false, pendingDeepLink: false })).toBe(false);
  });
});

