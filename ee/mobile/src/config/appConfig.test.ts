import { describe, expect, it } from "vitest";
import { getAppConfig } from "./appConfig";

describe("getAppConfig", () => {
  it("returns an error when base url is missing", () => {
    process.env.EXPO_PUBLIC_ALGA_ENV = "dev";
    process.env.EXPO_PUBLIC_ALGA_BASE_URL = "";

    const out = getAppConfig();
    expect(out.ok).toBe(false);
  });

  it("normalizes base url", () => {
    process.env.EXPO_PUBLIC_ALGA_ENV = "dev";
    process.env.EXPO_PUBLIC_ALGA_BASE_URL = "https://example.com///";

    const out = getAppConfig();
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.baseUrl).toBe("https://example.com");
  });
});

