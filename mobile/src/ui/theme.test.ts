import { describe, expect, it } from "vitest";
import { colors, spacing, typography } from "./theme";

describe("theme primitives", () => {
  it("exports expected color tokens", () => {
    expect(colors.background).toMatch(/^#[0-9a-f]{6}$/i);
    expect(colors.text).toMatch(/^#[0-9a-f]{6}$/i);
    expect(colors.primary).toMatch(/^#[0-9a-f]{6}$/i);
    expect(colors.primaryText).toMatch(/^#[0-9a-f]{6}$/i);
    expect(colors.border).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("exports spacing scale in ascending order", () => {
    expect(spacing.xs).toBeLessThan(spacing.sm);
    expect(spacing.sm).toBeLessThan(spacing.md);
    expect(spacing.md).toBeLessThan(spacing.lg);
    expect(spacing.lg).toBeLessThan(spacing.xl);
  });

  it("exports basic typography presets", () => {
    expect(typography.title.fontSize).toBeGreaterThan(typography.body.fontSize);
    expect(typography.caption.fontSize).toBeLessThan(typography.body.fontSize);
  });
});

