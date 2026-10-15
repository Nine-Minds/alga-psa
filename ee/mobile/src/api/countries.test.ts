import { describe, expect, it, vi } from "vitest";
import { findCountry, listCountries } from "./countries";
import type { ApiClient } from "./client";

describe("countries api", () => {
  it("calls GET /api/v1/countries with the api key", async () => {
    const client = { request: vi.fn().mockResolvedValue({ ok: true, data: { data: [] } }) } as unknown as ApiClient;

    await listCountries(client, { apiKey: "key-1" });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/countries",
      signal: undefined,
      headers: { "x-api-key": "key-1" },
    });
  });

  it("matches codes case-insensitively and returns null for unknown or blank codes", () => {
    const countries = [{ code: "US", name: "United States" }, { code: "GB", name: "United Kingdom" }];
    expect(findCountry(countries, "gb")?.name).toBe("United Kingdom");
    expect(findCountry(countries, "XX")).toBeNull();
    expect(findCountry(countries, null)).toBeNull();
  });
});
