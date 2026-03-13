import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => {
  const Stub = () => null;
  return {
    View: Stub,
    Text: Stub,
    Pressable: Stub,
    TextInput: Stub,
    Modal: Stub,
    ScrollView: Stub,
    FlatList: Stub,
    ActivityIndicator: Stub,
    Platform: { OS: "ios" },
    useColorScheme: () => "light",
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  };
});

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@expo/vector-icons", () => {
  const Stub = () => null;
  return {
    Feather: Stub,
    Ionicons: Stub,
  };
});

describe("ui components", () => {
  it("exports Card component", async () => {
    const mod = await import("./index");
    expect(typeof mod.Card).toBe("function");
  });

  it("exports Separator component", async () => {
    const mod = await import("./index");
    expect(typeof mod.Separator).toBe("function");
  });

  it("exports SectionHeader component", async () => {
    const mod = await import("./index");
    expect(typeof mod.SectionHeader).toBe("function");
  });

  it("exports Avatar component", async () => {
    const mod = await import("./index");
    expect(typeof mod.Avatar).toBe("function");
  });

  it("exports IconButton component", async () => {
    const mod = await import("./index");
    expect(typeof mod.IconButton).toBe("function");
  });

  it("exports TextInput component", async () => {
    const mod = await import("./index");
    expect(typeof mod.TextInput).toBe("function");
  });

  it("exports ListRow component", async () => {
    const mod = await import("./index");
    expect(typeof mod.ListRow).toBe("function");
  });

  it("exports BottomSheet component", async () => {
    const mod = await import("./index");
    expect(typeof mod.BottomSheet).toBe("function");
  });

  it("exports SearchBar component", async () => {
    const mod = await import("./index");
    expect(typeof mod.SearchBar).toBe("function");
  });

  it("exports Select component", async () => {
    const mod = await import("./index");
    expect(typeof mod.Select).toBe("function");
  });

  it("exports existing components (Badge, PrimaryButton, OfflineBanner)", async () => {
    const mod = await import("./index");
    expect(typeof mod.Badge).toBe("function");
    expect(typeof mod.PrimaryButton).toBe("function");
    expect(typeof mod.OfflineBanner).toBe("function");
  });
});
