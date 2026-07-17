import { describe, expect, it } from "vitest";
import { sanitizeDecimalInput, sanitizeQuantityInput, sanitizeSignedQuantityInput } from "./numericInput";

describe("numericInput sanitizers", () => {
  it("quantity keeps digits only", () => {
    expect(sanitizeQuantityInput("12abc3")).toBe("123");
    expect(sanitizeQuantityInput("hello")).toBe("");
  });

  it("signed quantity keeps one leading minus", () => {
    expect(sanitizeSignedQuantityInput("-3x")).toBe("-3");
    expect(sanitizeSignedQuantityInput("4-2")).toBe("42");
  });

  it("decimal keeps a single separator and maps comma to dot", () => {
    expect(sanitizeDecimalInput("12,50")).toBe("12.50");
    expect(sanitizeDecimalInput("1.2.3abc")).toBe("1.23");
  });
});
