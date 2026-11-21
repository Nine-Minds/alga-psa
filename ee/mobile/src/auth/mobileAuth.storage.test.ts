import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  deleteItem: vi.fn(),
}));

vi.mock("../storage/secureStorage", () => ({
  getSecureJson: async (key: string) => (mocks.store.has(key) ? mocks.store.get(key) : null),
  setSecureJson: async (key: string, value: unknown) => {
    mocks.store.set(key, value);
  },
  secureStorage: {
    deleteItem: async (key: string) => {
      mocks.deleteItem(key);
      mocks.store.delete(key);
    },
  },
}));

vi.mock("expo-linking", () => ({
  createURL: (path: string) => `alga://${path}`,
}));

import {
  attachPendingAppleLinkToState,
  buildWebSignOutUrl,
  clearPendingAppleLink,
  clearPendingMobileAuth,
  clearReceivedOtt,
  createPendingMobileAuth,
  getPendingAppleLink,
  getPendingMobileAuth,
  getReceivedOtt,
  getSignedOutRedirectUri,
  parseAuthCallback,
  storePendingAppleLink,
  storeReceivedOtt,
} from "./mobileAuth";

describe("mobileAuth pending state storage", () => {
  beforeEach(() => {
    mocks.store.clear();
    mocks.deleteItem.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a unique pending state and reads it back", async () => {
    const a = await createPendingMobileAuth();
    expect(a.createdAtMs).toBe(Date.now());
    expect(a.state.split(".")).toHaveLength(3);
    await expect(getPendingMobileAuth()).resolves.toEqual(a);

    const b = await createPendingMobileAuth();
    expect(b.state).not.toBe(a.state);
    await expect(getPendingMobileAuth()).resolves.toEqual(b);

    await clearPendingMobileAuth();
    await expect(getPendingMobileAuth()).resolves.toBeNull();
  });

  it("stores and clears a received OTT", async () => {
    await storeReceivedOtt("ott-1", "state-1");
    await expect(getReceivedOtt()).resolves.toEqual({ ott: "ott-1", state: "state-1", receivedAtMs: Date.now() });
    await clearReceivedOtt();
    await expect(getReceivedOtt()).resolves.toBeNull();
  });

  it("keeps a pending Apple link for ten minutes and then expires it", async () => {
    await storePendingAppleLink({ identityToken: "id-token", authorizationCode: "code" });
    vi.advanceTimersByTime(10 * 60_000);
    await expect(getPendingAppleLink()).resolves.toMatchObject({ identityToken: "id-token", authorizationCode: "code" });

    vi.advanceTimersByTime(1);
    await expect(getPendingAppleLink()).resolves.toBeNull();
    expect(mocks.deleteItem).toHaveBeenCalledWith("alga.mobile.auth.appleLink");
  });

  it("attaches the sign-in state to a live Apple link", async () => {
    await storePendingAppleLink({ identityToken: "id-token" });
    const updated = await attachPendingAppleLinkToState("state-9");
    expect(updated).toMatchObject({ identityToken: "id-token", state: "state-9" });
    await expect(getPendingAppleLink()).resolves.toMatchObject({ state: "state-9" });
  });

  it("does not attach state when there is no pending Apple link", async () => {
    await expect(attachPendingAppleLinkToState("state-9")).resolves.toBeNull();
    expect(mocks.store.size).toBe(0);
  });

  it("clears a pending Apple link", async () => {
    await storePendingAppleLink({ identityToken: "id-token" });
    await clearPendingAppleLink();
    await expect(getPendingAppleLink()).resolves.toBeNull();
  });
});

describe("mobileAuth URLs", () => {
  it("builds the web sign-out URL with the signed-out redirect", () => {
    const redirect = getSignedOutRedirectUri();
    expect(redirect).toBe("alga://auth/signed-out");
    const url = new URL(buildWebSignOutUrl({ baseUrl: "https://tenant.example.com/ignored", redirectUri: redirect }));
    expect(url.origin + url.pathname).toBe("https://tenant.example.com/auth/mobile/signout");
    expect(url.searchParams.get("redirect")).toBe("alga://auth/signed-out");
  });

  it("recognizes path-style universal-link callbacks", () => {
    expect(parseAuthCallback("https://app.example.com/mobile/auth/callback?ott=o&state=s")).toEqual({
      ott: "o",
      state: "s",
      error: undefined,
    });
  });
});
