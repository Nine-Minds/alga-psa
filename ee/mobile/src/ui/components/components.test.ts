import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

const PORTRAIT_WINDOW = { width: 390, height: 844 };
let windowSize = PORTRAIT_WINDOW;

vi.mock("react-native", () => {
  const Stub = () => null;
  // Modal/View pass children through so a sheet can be inspected end to end.
  const Passthrough = ({ children }: { children?: React.ReactNode }) => children ?? null;
  return {
    View: Passthrough,
    Text: Stub,
    Pressable: Stub,
    TextInput: Stub,
    Modal: Passthrough,
    ScrollView: Stub,
    FlatList: Stub,
    ActivityIndicator: Stub,
    Platform: { OS: "ios" },
    useColorScheme: () => "light",
    useWindowDimensions: () => windowSize,
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

describe("BottomSheet sizing", () => {
  afterEach(() => {
    windowSize = PORTRAIT_WINDOW;
  });

  async function sheetHeight(snapPoint: "quarter" | "half" | "full"): Promise<number> {
    const { BottomSheet } = await import("./index");
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        React.createElement(BottomSheet, {
          visible: true,
          onClose: () => {},
          title: "Filters",
          snapPoint,
          children: null,
        }),
      );
    });
    const sheets = renderer.root.findAll(
      (node) => node.props?.style?.borderTopLeftRadius !== undefined,
    );
    expect(sheets).toHaveLength(1);
    return sheets[0].props.style.height as number;
  }

  it("derives the sheet height from the current window", async () => {
    expect(await sheetHeight("half")).toBeCloseTo(PORTRAIT_WINDOW.height * 0.5);
  });

  // Landscape and large-screen windows: the sheet must stay inside the window
  // now that the app no longer locks itself to portrait.
  it("still fits when the window is landscape", async () => {
    windowSize = { width: 844, height: 390 };
    const height = await sheetHeight("full");
    expect(height).toBeCloseTo(390 * 0.92);
    expect(height).toBeLessThanOrEqual(windowSize.height);
  });
});
