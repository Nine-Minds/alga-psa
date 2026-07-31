import { describe, expect, it } from "vitest";
import { parseServerHostPayload } from "./serverQr";

describe("parseServerHostPayload", () => {
  it("parses the connect-this-server deep link", () => {
    expect(parseServerHostPayload("alga://server?url=https%3A%2F%2Fhelpdesk.acme.com")).toBe(
      "https://helpdesk.acme.com",
    );
  });

  it("parses an unencoded url param", () => {
    expect(parseServerHostPayload("alga://server?url=https://helpdesk.acme.com")).toBe(
      "https://helpdesk.acme.com",
    );
  });

  it("accepts a raw https URL payload", () => {
    expect(parseServerHostPayload("https://helpdesk.acme.com/")).toBe("https://helpdesk.acme.com");
  });

  it("accepts a bare hostname payload", () => {
    expect(parseServerHostPayload("helpdesk.acme.com")).toBe("https://helpdesk.acme.com");
  });

  it("accepts http targets in dev builds", () => {
    // vitest.setup.ts sets __DEV__ = true
    expect(parseServerHostPayload("alga://server?url=http%3A%2F%2F192.168.64.2%3A3000")).toBe(
      "http://192.168.64.2:3000",
    );
  });

  it("rejects http targets in release builds", () => {
    const testGlobals = globalThis as { __DEV__?: boolean };
    testGlobals.__DEV__ = false;
    try {
      expect(parseServerHostPayload("alga://server?url=http%3A%2F%2F192.168.64.2%3A3000")).toBeNull();
      expect(parseServerHostPayload("http://192.168.64.2:3000")).toBeNull();
    } finally {
      testGlobals.__DEV__ = true;
    }
  });

  it("rejects other alga:// deep links", () => {
    expect(parseServerHostPayload("alga://ticket/123")).toBeNull();
    expect(parseServerHostPayload("alga://signin")).toBeNull();
  });

  it("rejects a server link without a url param", () => {
    expect(parseServerHostPayload("alga://server")).toBeNull();
  });

  it("rejects empty payloads", () => {
    expect(parseServerHostPayload("")).toBeNull();
    expect(parseServerHostPayload("   ")).toBeNull();
  });
});
