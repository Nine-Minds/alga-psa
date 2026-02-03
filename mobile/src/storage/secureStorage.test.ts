import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "web" },
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));

describe("secureStorage (web fallback)", () => {
  it("stores and loads JSON via localStorage when Platform.OS=web", async () => {
    const store = new Map<string, string>();
    const localStorageMock = {
      getItem: vi.fn((k: string) => store.get(k) ?? null),
      setItem: vi.fn((k: string, v: string) => void store.set(k, v)),
      removeItem: vi.fn((k: string) => void store.delete(k)),
    };

    (globalThis as any).localStorage = localStorageMock;

    const mod = await import("./secureStorage");

    await mod.setSecureJson("k", { a: 1 });
    expect(localStorageMock.setItem).toHaveBeenCalled();

    const value = await mod.getSecureJson<{ a: number }>("k");
    expect(value).toEqual({ a: 1 });

    await mod.secureStorage.deleteItem("k");
    expect(localStorageMock.removeItem).toHaveBeenCalledWith("k");
    expect(await mod.getSecureJson("k")).toBeNull();
  });

  it("returns null when stored JSON is invalid", async () => {
    const localStorageMock = {
      getItem: vi.fn((_k: string) => "{not-json"),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    (globalThis as any).localStorage = localStorageMock;

    const mod = await import("./secureStorage");
    expect(await mod.getSecureJson("bad")).toBeNull();
  });
});

