import { describe, expect, it } from "vitest";
import { decodeQaSession, parseTicketRichTextQaScenario } from "./ticketRichTextQa";

function encodeBase64Url(value: string): string {
  const maybeBuffer = (globalThis as typeof globalThis & {
    Buffer?: {
      from: (input: string, encoding: string) => { toString: (outputEncoding: string) => string };
    };
  }).Buffer;
  if (!maybeBuffer) {
    throw new Error("Buffer is not available in this test environment");
  }

  return maybeBuffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

describe("ticketRichTextQa", () => {
  it("decodes a serialized dev QA session payload", () => {
    const encoded = encodeBase64Url(
      JSON.stringify({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresAtMs: 123456,
        tenantId: "tenant-1",
        user: {
          id: "user-1",
          email: "qa@example.com",
          name: "QA User",
        },
      }),
    );

    expect(decodeQaSession(encoded)).toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAtMs: 123456,
      tenantId: "tenant-1",
      user: {
        id: "user-1",
        email: "qa@example.com",
        name: "QA User",
      },
    });
  });

  it("rejects malformed dev QA session payloads and unknown scenarios", () => {
    expect(decodeQaSession("not-base64")).toBeNull();
    expect(parseTicketRichTextQaScenario("unknown")).toBeNull();
    expect(parseTicketRichTextQaScenario("richtext-smoke")).toBe("richtext-smoke");
  });
});
