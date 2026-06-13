import { describe, expect, it } from "vitest";
import {
  adaptColorsForDarkMode,
  generateEntityColor,
  getReadableTextColor,
  getTagChipColors,
} from "./tagColors";

describe("generateEntityColor", () => {
  it("matches the web implementation for known tag texts", () => {
    // Truth vectors computed with packages/tags/src/lib/colorUtils.ts.
    expect(generateEntityColor("urgent")).toEqual({ background: "#d9fce2", text: "#05611c" });
    expect(generateEntityColor("vip")).toEqual({ background: "#d9fcdc", text: "#05610d" });
    expect(generateEntityColor("billing")).toEqual({ background: "#fcd9e0", text: "#79061b" });
    expect(generateEntityColor("follow-up")).toEqual({ background: "#dafcd9", text: "#076105" });
  });

  it("is deterministic", () => {
    expect(generateEntityColor("anything")).toEqual(generateEntityColor("anything"));
  });
});

describe("adaptColorsForDarkMode", () => {
  it("darkens light backgrounds and lightens dark text", () => {
    const adapted = adaptColorsForDarkMode({ background: "#d9fce2", text: "#05611c" });
    expect(adapted.background).not.toBe("#d9fce2");
    expect(adapted.text).not.toBe("#05611c");

    const bgLuma = parseInt(adapted.background.slice(1, 3), 16);
    const originalBgLuma = parseInt("d9", 16);
    expect(bgLuma).toBeLessThan(originalBgLuma);
  });

  it("leaves dark backgrounds and light text untouched", () => {
    expect(adaptColorsForDarkMode({ background: "#11182b", text: "#ffffff" })).toEqual({
      background: "#11182b",
      text: "#ffffff",
    });
  });
});

describe("getReadableTextColor", () => {
  it("returns white on dark backgrounds", () => {
    expect(getReadableTextColor("#000000")).toBe("#FFFFFF");
    expect(getReadableTextColor("#1E3A8A")).toBe("#FFFFFF");
  });

  it("returns a dark color on light backgrounds", () => {
    expect(getReadableTextColor("#FFFFFF")).toBe("#1F2937");
    expect(getReadableTextColor("#FEF3C7")).toBe("#1F2937");
  });
});

describe("getTagChipColors", () => {
  it("keeps stored colors in light mode", () => {
    expect(getTagChipColors({ tag_text: "vip", background_color: "#FEF3C7", text_color: "#92400E" }, "light")).toEqual({
      backgroundColor: "#FEF3C7",
      textColor: "#92400E",
      borderColor: "#FEF3C7",
    });
  });

  it("derives a readable text color when only the background is stored", () => {
    expect(getTagChipColors({ tag_text: "dark", background_color: "#11182B", text_color: null }, "light")).toEqual({
      backgroundColor: "#11182B",
      textColor: "#FFFFFF",
      borderColor: "#11182B",
    });
  });

  it("generates web-parity colors when none are stored", () => {
    expect(getTagChipColors({ tag_text: "urgent", background_color: null, text_color: null }, "light")).toEqual({
      backgroundColor: "#d9fce2",
      textColor: "#05611c",
      borderColor: "#d9fce2",
    });
  });

  it("ignores invalid stored colors and falls back to generated ones", () => {
    const generated = generateEntityColor("urgent");
    expect(getTagChipColors({ tag_text: "urgent", background_color: "red", text_color: "#FFFFFF" }, "light").backgroundColor).toBe(
      generated.background,
    );
  });

  it("adapts colors in dark mode", () => {
    const light = getTagChipColors({ tag_text: "urgent" }, "light");
    const dark = getTagChipColors({ tag_text: "urgent" }, "dark");
    expect(dark.backgroundColor).not.toBe(light.backgroundColor);
    expect(dark.borderColor).toBe(dark.backgroundColor);
  });
});
