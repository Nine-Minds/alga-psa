import { describe, expect, it } from "vitest";
import { createScanDebounce } from "./scanDebounce";

describe("createScanDebounce", () => {
  it("T131 swallows a repeat of the same code inside the window", () => {
    const debounce = createScanDebounce(1000);

    expect(debounce.accept("A", 0)).toBe(true);
    expect(debounce.accept("A", 500)).toBe(false);
    expect(debounce.accept("A", 1200)).toBe(true);
  });

  it("T131 lets a different code through at once, and reset re-arms the last one", () => {
    const debounce = createScanDebounce(1000);

    expect(debounce.accept("A", 0)).toBe(true);
    expect(debounce.accept("B", 10)).toBe(true);

    debounce.reset();
    expect(debounce.accept("B", 20)).toBe(true);
  });
});
