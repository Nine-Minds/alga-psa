import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Feather } from "@expo/vector-icons";
import { goBackOrTabs, HeaderBackButton, headerBackOptions } from "./HeaderBackButton";

function render(element: React.ReactElement): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(element);
  });
  if (renderer === undefined) {
    throw new Error("Renderer was not created");
  }
  return renderer;
}

describe("HeaderBackButton", () => {
  it("renders an accessible pressable with generous hit slop", () => {
    const renderer = render(<HeaderBackButton label="Back" onPress={() => undefined} />);
    const pressable = renderer.root.findAll((n) => (n.type as string) === "Pressable")[0];
    expect(pressable.props.accessibilityRole).toBe("button");
    expect(pressable.props.accessibilityLabel).toBe("Back");
    expect(pressable.props.hitSlop).toEqual({ top: 16, bottom: 16, left: 16, right: 16 });
  });

  it("renders a chevron icon and the label text", () => {
    const renderer = render(<HeaderBackButton label="Tickets" onPress={() => undefined} />);
    const icon = renderer.root.findByType(Feather);
    expect(icon.props.name).toBe("chevron-left");
    const text = renderer.root.findAll((n) => (n.type as string) === "Text")[0];
    expect(text.props.children).toBe("Tickets");
  });

  it("calls onPress when pressed", () => {
    const onPress = vi.fn();
    const renderer = render(<HeaderBackButton label="Back" onPress={onPress} />);
    const pressable = renderer.root.findAll((n) => (n.type as string) === "Pressable")[0];
    act(() => {
      pressable.props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("headerBackOptions", () => {
  it("hides the native back button and wires headerLeft to onPress", () => {
    const onPress = vi.fn();
    const options = headerBackOptions("Tickets", onPress);
    expect(options.headerBackVisible).toBe(false);
    const renderer = render(<>{options.headerLeft()}</>);
    const pressable = renderer.root.findAll((n) => (n.type as string) === "Pressable")[0];
    expect(pressable.props.accessibilityLabel).toBe("Tickets");
    act(() => {
      pressable.props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("goBackOrTabs", () => {
  it("goes back when possible", () => {
    const navigation = { canGoBack: () => true, goBack: vi.fn(), navigate: vi.fn() };
    goBackOrTabs(navigation)();
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("falls back to Tabs when the stack cannot go back", () => {
    const navigation = { canGoBack: () => false, goBack: vi.fn(), navigate: vi.fn() };
    goBackOrTabs(navigation)();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(navigation.navigate).toHaveBeenCalledWith("Tabs");
  });
});
