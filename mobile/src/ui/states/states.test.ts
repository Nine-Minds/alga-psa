import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => {
  const Stub = () => null;
  return {
    View: Stub,
    Text: Stub,
    ActivityIndicator: Stub,
    Pressable: Stub,
  };
});

describe("ui states", () => {
  it("exports standard empty/loading/error state components", async () => {
    const mod = await import("./index");
    expect(typeof mod.EmptyState).toBe("function");
    expect(typeof mod.LoadingState).toBe("function");
    expect(typeof mod.ErrorState).toBe("function");
  });
});

