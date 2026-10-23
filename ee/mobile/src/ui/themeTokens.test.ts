import { describe, expect, it } from "vitest";
import { MOBILE_THEME_TOKEN_KEYS, parseMobileTheme } from "./themeTokens";
import { ALGA_THEME_TOKENS } from "./themes";

const block = (overrides: Record<string, unknown> = {}) => ({
  pairId: "forest",
  label: "Forest",
  light: { ...ALGA_THEME_TOKENS.light },
  dark: { ...ALGA_THEME_TOKENS.dark },
  version: "abc123",
  ...overrides,
});

describe("parseMobileTheme", () => {
  it("T015 accepts a well-formed theme block", () => {
    const parsed = parseMobileTheme(block());
    expect(parsed?.pairId).toBe("forest");
    expect(parsed?.label).toBe("Forest");
    expect(parsed?.version).toBe("abc123");
    expect(Object.keys(parsed?.light ?? {})).toEqual([...MOBILE_THEME_TOKEN_KEYS]);
  });

  it("T015 rejects missing keys, non-hex values and unknown pairIds without throwing", () => {
    const missingKey = block();
    delete (missingKey.light as Record<string, unknown>).border;

    expect(parseMobileTheme(missingKey)).toBeNull();
    expect(parseMobileTheme(block({ light: { ...ALGA_THEME_TOKENS.light, border: "rebeccapurple" } }))).toBeNull();
    expect(parseMobileTheme(block({ pairId: "neon" }))).toBeNull();
    expect(parseMobileTheme(block({ version: "" }))).toBeNull();
    expect(parseMobileTheme(block({ dark: null }))).toBeNull();
    expect(parseMobileTheme(null)).toBeNull();
    expect(parseMobileTheme("forest")).toBeNull();
    expect(parseMobileTheme([])).toBeNull();
  });

  it("T015 falls back to the pair id when the label is missing", () => {
    expect(parseMobileTheme(block({ label: undefined }))?.label).toBe("forest");
  });
});
