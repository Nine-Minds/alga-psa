import { describe, expect, it } from "vitest";
import { getAppConfig } from "./appConfig";

describe("getAppConfig", () => {
  it("returns the hardcoded hosted base url", () => {
    process.env.EXPO_PUBLIC_ALGA_ENV = "dev";

    const out = getAppConfig();
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.baseUrl).toBe("https://algapsa.com");
  });

  it("keeps hosted environment parsing", () => {
    process.env.EXPO_PUBLIC_ALGA_ENV = "prod";
    const out = getAppConfig();
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.baseUrl).toBe("https://algapsa.com");
      expect(out.env).toBe("prod");
    }
  });
});
