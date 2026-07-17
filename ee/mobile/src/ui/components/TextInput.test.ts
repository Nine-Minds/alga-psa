import { describe, expect, it } from "vitest";
import { sanitizeNumericText } from "./TextInput";

describe("sanitizeNumericText", () => {
  it("integer keeps digits only", () => {
    expect(sanitizeNumericText("12abc3", "integer")).toBe("123");
    expect(sanitizeNumericText("hello", "integer")).toBe("");
  });

  it("signed keeps one leading minus", () => {
    expect(sanitizeNumericText("-3x", "signed")).toBe("-3");
    expect(sanitizeNumericText("4-2", "signed")).toBe("42");
  });

  it("decimal keeps a single separator and maps comma to dot", () => {
    expect(sanitizeNumericText("12,50", "decimal")).toBe("12.50");
    expect(sanitizeNumericText("1.2.3abc", "decimal")).toBe("1.23");
  });
});
