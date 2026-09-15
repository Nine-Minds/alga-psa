import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    store.delete(key);
  }),
}));

import { clearCachedTheme, readCachedTheme, themeCacheKey, writeCachedTheme } from "./themeCache";
import { ALGA_THEME_TOKENS } from "./themes";
import type { MobileTheme } from "./themeTokens";

const theme: MobileTheme = {
  pairId: "forest",
  label: "Forest",
  light: ALGA_THEME_TOKENS.light,
  dark: ALGA_THEME_TOKENS.dark,
  version: "v1",
};

const BASE_URL = "https://alga.example.com";
const TENANT = "tenant-1";

describe("theme cache", () => {
  beforeEach(() => {
    store.clear();
  });

  it("T035 keys the cache by server and tenant", () => {
    expect(themeCacheKey(BASE_URL, TENANT)).toBe("alga.mobile.theme.tokens.https___alga.example.com.tenant-1");
    expect(themeCacheKey(null, TENANT)).toBeNull();
    expect(themeCacheKey(BASE_URL, undefined)).toBeNull();
  });

  it("T035 writes and reads back the theme block", async () => {
    await writeCachedTheme(BASE_URL, TENANT, theme);
    await expect(readCachedTheme(BASE_URL, TENANT)).resolves.toEqual(theme);
  });

  it("T037 ignores a cached block belonging to another server or tenant", async () => {
    await writeCachedTheme(BASE_URL, TENANT, theme);

    await expect(readCachedTheme("https://other.example.com", TENANT)).resolves.toBeNull();
    await expect(readCachedTheme(BASE_URL, "tenant-2")).resolves.toBeNull();

    // Even if a sanitised key collided, the stored identity is re-checked.
    const key = themeCacheKey(BASE_URL, TENANT) as string;
    store.set(key, JSON.stringify({ baseUrl: "https://other.example.com", tenantId: TENANT, theme }));
    await expect(readCachedTheme(BASE_URL, TENANT)).resolves.toBeNull();
  });

  it("T037 ignores a cached block that no longer parses", async () => {
    const key = themeCacheKey(BASE_URL, TENANT) as string;
    store.set(key, JSON.stringify({
      baseUrl: BASE_URL,
      tenantId: TENANT,
      theme: { ...theme, light: { background: "#fff" } },
    }));
    await expect(readCachedTheme(BASE_URL, TENANT)).resolves.toBeNull();

    store.set(key, "{not json");
    await expect(readCachedTheme(BASE_URL, TENANT)).resolves.toBeNull();
  });

  it("T038 clears the cached block on sign-out", async () => {
    await writeCachedTheme(BASE_URL, TENANT, theme);
    await clearCachedTheme(BASE_URL, TENANT);
    await expect(readCachedTheme(BASE_URL, TENANT)).resolves.toBeNull();
  });
});
