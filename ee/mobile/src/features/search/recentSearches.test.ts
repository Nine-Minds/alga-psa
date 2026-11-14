import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSecureJson: vi.fn(),
  setSecureJson: vi.fn(),
}));

vi.mock("../../storage/secureStorage", () => ({
  getSecureJson: (...args: unknown[]) => mocks.getSecureJson(...args),
  setSecureJson: (...args: unknown[]) => mocks.setSecureJson(...args),
}));
vi.mock("../../logging/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import {
  clearRecentSearches,
  nextRecentSearches,
  readRecentSearches,
  recentSearchesKey,
  writeRecentSearches,
} from "./recentSearches";

describe("recentSearches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSecureJson.mockResolvedValue(null);
    mocks.setSecureJson.mockResolvedValue(undefined);
  });

  it("T124 builds a key expo-secure-store accepts from a host URL", () => {
    const key = recentSearchesKey("https://ects.algapsa.com", "user-1");

    // SecureStore rejects anything outside this set, and a raw baseUrl has ':' and '/'.
    expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(key).toContain("user-1");
  });

  it("T124 keeps two hosts apart", () => {
    expect(recentSearchesKey("https://a.algapsa.com", "u")).not.toBe(recentSearchesKey("https://b.algapsa.com", "u"));
  });

  it("T124 a storage failure never escapes the read, write or clear", async () => {
    mocks.getSecureJson.mockRejectedValue(new Error("Invalid key"));
    mocks.setSecureJson.mockRejectedValue(new Error("Invalid key"));

    await expect(readRecentSearches("alga.mobile.search.recent.k")).resolves.toEqual([]);
    await expect(writeRecentSearches("alga.mobile.search.recent.k", ["a"])).resolves.toBeUndefined();
    await expect(clearRecentSearches("https://ects.algapsa.com", "user-1")).resolves.toBeUndefined();
  });

  it("T093 keeps the newest query first and caps the history at eight", () => {
    const history = ["g", "f", "e", "d", "c", "b", "a"];

    const next = nextRecentSearches(nextRecentSearches(history, "h"), "f");

    expect(next[0]).toBe("f");
    expect(next).toHaveLength(8);
    expect(next.filter((entry) => entry === "f")).toHaveLength(1);
  });
});
