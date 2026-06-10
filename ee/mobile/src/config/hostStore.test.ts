import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../storage/secureStorage", () => {
  const store = new Map<string, string>();
  return {
    secureStorage: {
      getItem: async (key: string) => store.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        store.set(key, value);
      },
      deleteItem: async (key: string) => {
        store.delete(key);
      },
    },
  };
});

import { secureStorage } from "../storage/secureStorage";
import { clearStoredHost, loadStoredHost, normalizeHostInput, saveStoredHost } from "./hostStore";

describe("normalizeHostInput", () => {
  it("prefixes bare hostnames with https://", () => {
    expect(normalizeHostInput("helpdesk.acme.com")).toBe("https://helpdesk.acme.com");
  });

  it("strips trailing slashes, query, and hash", () => {
    expect(normalizeHostInput("https://helpdesk.acme.com/?x=1#y")).toBe("https://helpdesk.acme.com");
  });

  it("keeps explicit ports", () => {
    expect(normalizeHostInput("helpdesk.acme.com:8443")).toBe("https://helpdesk.acme.com:8443");
  });

  // TODO(harden): flip back to rejection when https is enforced for user input.
  it("temporarily accepts explicit http:// hosts", () => {
    expect(normalizeHostInput("http://192.168.64.2:3000")).toBe("http://192.168.64.2:3000");
  });

  it("rejects non-http(s) schemes and garbage", () => {
    expect(normalizeHostInput("ftp://helpdesk.acme.com")).toBeUndefined();
    expect(normalizeHostInput("")).toBeUndefined();
    expect(normalizeHostInput("   ")).toBeUndefined();
  });
});

describe("hostStore persistence", () => {
  beforeEach(async () => {
    await clearStoredHost();
  });

  it("round-trips a saved host", async () => {
    const saved = await saveStoredHost("helpdesk.acme.com");
    expect(saved).toBe("https://helpdesk.acme.com");
    expect(await loadStoredHost()).toBe("https://helpdesk.acme.com");
  });

  it("throws when saving a non-http(s) host", async () => {
    await expect(saveStoredHost("ftp://helpdesk.acme.com")).rejects.toThrow();
    expect(await loadStoredHost()).toBeNull();
  });

  it("clears the stored host", async () => {
    await saveStoredHost("https://helpdesk.acme.com");
    await clearStoredHost();
    expect(await loadStoredHost()).toBeNull();
  });

  it("ignores an invalid value already in storage", async () => {
    await secureStorage.setItem("alga.mobile.customHost", "ftp://bad.example.com");
    expect(await loadStoredHost()).toBeNull();
  });
});
