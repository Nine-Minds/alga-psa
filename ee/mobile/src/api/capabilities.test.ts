import { describe, expect, it, vi } from "vitest";
import { EMPTY_FEATURE_CAPABILITIES, getMyCapabilities, parseFeatureCapabilities, type MyCapabilities } from "./capabilities";
import type { ApiClient } from "./client";
import { ALGA_THEME_TOKENS } from "../ui/themes";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("capabilities api", () => {
  it("calls GET /api/v1/mobile/me/capabilities with the api key", async () => {
    const client = mockClient({ ok: true, data: { data: { features: { ...EMPTY_FEATURE_CAPABILITIES, inventory: true } } } });
    const signal = new AbortController().signal;

    await getMyCapabilities(client, { apiKey: "api-key-1", signal });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/mobile/me/capabilities",
      signal,
      headers: {
        "x-api-key": "api-key-1",
      },
    });
  });

  it("T030 types a response with and without the theme block", () => {
    const withoutTheme: MyCapabilities = {
      features: { ...EMPTY_FEATURE_CAPABILITIES, inventory: true },
    };
    const withTheme: MyCapabilities = {
      features: { ...EMPTY_FEATURE_CAPABILITIES, inventory: true },
      theme: {
        pairId: "forest",
        label: "Forest",
        light: ALGA_THEME_TOKENS.light,
        dark: ALGA_THEME_TOKENS.dark,
        version: "forest-v1",
      },
    };

    expect(withoutTheme.theme).toBeUndefined();
    expect(withTheme.theme?.pairId).toBe("forest");
  });

  it("turns on only the flags the server sent as true", () => {
    expect(parseFeatureCapabilities({ inventory: true, clientsCreate: true, contactsUpdate: "yes" })).toEqual({
      ...EMPTY_FEATURE_CAPABILITIES,
      inventory: true,
      clientsCreate: true,
    });
    expect(parseFeatureCapabilities(undefined)).toEqual(EMPTY_FEATURE_CAPABILITIES);
  });
});
