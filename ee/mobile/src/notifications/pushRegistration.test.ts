import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("../storage/secureStorage", () => ({
  secureStorage: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => { store.set(key, value); },
    deleteItem: async (key: string) => { store.delete(key); },
  },
  getSecureJson: async (key: string) => {
    const raw = store.get(key);
    return raw ? JSON.parse(raw) : null;
  },
  setSecureJson: async (key: string, value: unknown) => { store.set(key, JSON.stringify(value)); },
}));

import {
  LEGACY_PUSH_TOKEN_KEY,
  PUSH_REGISTRATION_KEY,
  PUSH_REGISTRATION_TTL_MS,
  clearPushRegistration,
  isRegisteredFor,
  readPushRegistration,
  shouldRegisterPushToken,
  writePushRegistration,
} from "./pushRegistration";

const ctx = { token: "ExponentPushToken[abc]", baseUrl: "https://alga.example", tenantId: "t1", userId: "u1" };
const record = { ...ctx, registeredAt: 1_000_000 };

describe("shouldRegisterPushToken", () => {
  it("registers when nothing is recorded", () => {
    expect(shouldRegisterPushToken(null, ctx, record.registeredAt)).toBe(true);
  });

  it("skips a fresh registration for the same server, account, and token", () => {
    expect(shouldRegisterPushToken(record, ctx, record.registeredAt + 1000)).toBe(false);
  });

  it("re-registers when the server, tenant, user, or token differs", () => {
    expect(shouldRegisterPushToken(record, { ...ctx, baseUrl: "https://appliance.local" }, record.registeredAt)).toBe(true);
    expect(shouldRegisterPushToken(record, { ...ctx, tenantId: "t2" }, record.registeredAt)).toBe(true);
    expect(shouldRegisterPushToken(record, { ...ctx, userId: "u2" }, record.registeredAt)).toBe(true);
    expect(shouldRegisterPushToken(record, { ...ctx, token: "ExponentPushToken[new]" }, record.registeredAt)).toBe(true);
  });

  it("re-registers once the record is a day old", () => {
    expect(shouldRegisterPushToken(record, ctx, record.registeredAt + PUSH_REGISTRATION_TTL_MS - 1)).toBe(false);
    expect(shouldRegisterPushToken(record, ctx, record.registeredAt + PUSH_REGISTRATION_TTL_MS)).toBe(true);
  });
});

describe("isRegisteredFor", () => {
  it("matches on server and account without requiring the token", () => {
    expect(isRegisteredFor(record, { baseUrl: ctx.baseUrl, tenantId: "t1", userId: "u1" })).toBe(true);
    expect(isRegisteredFor(record, { baseUrl: ctx.baseUrl, tenantId: "t1", userId: "other" })).toBe(false);
    expect(isRegisteredFor(null, { baseUrl: ctx.baseUrl, tenantId: "t1", userId: "u1" })).toBe(false);
  });
});

describe("storage", () => {
  beforeEach(() => { store.clear(); });

  it("writes a scoped record and drops the legacy token-only marker", async () => {
    store.set(LEGACY_PUSH_TOKEN_KEY, JSON.stringify("ExponentPushToken[abc]"));
    await writePushRegistration(ctx, 42);
    expect(await readPushRegistration()).toEqual({ ...ctx, registeredAt: 42 });
    expect(store.has(LEGACY_PUSH_TOKEN_KEY)).toBe(false);
  });

  it("ignores malformed records and clears both keys", async () => {
    store.set(PUSH_REGISTRATION_KEY, JSON.stringify({ nope: true }));
    expect(await readPushRegistration()).toBeNull();
    store.set(LEGACY_PUSH_TOKEN_KEY, JSON.stringify("x"));
    await clearPushRegistration();
    expect(store.size).toBe(0);
  });
});
