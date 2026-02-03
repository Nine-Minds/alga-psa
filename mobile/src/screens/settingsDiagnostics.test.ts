import { describe, expect, it } from "vitest";
import { formatAppVersion } from "./settingsDiagnostics";

describe("settingsDiagnostics", () => {
  it("formats app version/build with safe fallbacks", () => {
    expect(formatAppVersion("1.2.3", "42")).toBe("1.2.3 (42)");
    expect(formatAppVersion(null, "42")).toBe("unknown (42)");
    expect(formatAppVersion("1.2.3", undefined)).toBe("1.2.3 (unknown)");
  });
});

