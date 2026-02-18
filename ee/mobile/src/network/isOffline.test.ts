import { describe, expect, it } from "vitest";
import { isOffline } from "./isOffline";

describe("isOffline", () => {
  it("treats explicit false connectivity as offline", () => {
    expect(isOffline({ isConnected: false, isInternetReachable: true })).toBe(true);
    expect(isOffline({ isConnected: true, isInternetReachable: false })).toBe(true);
  });

  it("treats unknown/null status as not definitively offline", () => {
    expect(isOffline({ isConnected: null, isInternetReachable: null })).toBe(false);
    expect(isOffline({})).toBe(false);
  });
});

