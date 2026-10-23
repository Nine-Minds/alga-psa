import { describe, expect, it, vi } from "vitest";
import { clearInheritedScreenParams } from "./inheritedScreenParams";

describe("clearInheritedScreenParams", () => {
  it("clears the nested screen params on every ancestor", () => {
    const root = { setParams: vi.fn(), getParent: () => undefined };
    const drawer = { setParams: vi.fn(), getParent: () => root };
    clearInheritedScreenParams({ getParent: () => drawer });
    expect(drawer.setParams).toHaveBeenCalledWith({ screen: undefined, params: undefined });
    expect(root.setParams).toHaveBeenCalledWith({ screen: undefined, params: undefined });
  });

  it("is a no-op without a parent", () => {
    expect(() => clearInheritedScreenParams({ getParent: () => undefined })).not.toThrow();
  });
});
