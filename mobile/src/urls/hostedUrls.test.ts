import { describe, expect, it } from "vitest";
import { buildHostedPathUrl, buildTicketWebUrl, tryBuildHostedPathUrl } from "./hostedUrls";

describe("hostedUrls", () => {
  it("builds absolute URLs from base + path", () => {
    expect(buildHostedPathUrl("https://example.com", "/msp/tickets/1")).toBe(
      "https://example.com/msp/tickets/1",
    );
    expect(buildHostedPathUrl("https://example.com/", "legal/privacy")).toBe(
      "https://example.com/legal/privacy",
    );
  });

  it("returns null for invalid base URLs", () => {
    expect(tryBuildHostedPathUrl(null, "/msp/tickets/1")).toBeNull();
    expect(tryBuildHostedPathUrl("not a url", "/msp/tickets/1")).toBeNull();
  });

  it("builds ticket URLs and encodes ticket ids", () => {
    expect(buildTicketWebUrl("https://example.com", "abc/123")).toBe(
      "https://example.com/msp/tickets/abc%2F123",
    );
  });
});

