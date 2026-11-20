import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { SegmentChips } from "./SegmentChips";

const SEGMENTS = [
  { key: "home", label: "Today" },
  { key: "stock", label: "Stock" },
] as const;

function chip(tree: ReactTestRenderer, key: string) {
  return tree.root.find((n) => String(n.type) === "Pressable" && n.props.testID === `inv-segment-${key}`);
}

describe("SegmentChips", () => {
  it("renders one chip per segment and marks only the active one selected", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<SegmentChips idPrefix="inv" segments={[...SEGMENTS]} active="stock" onChange={vi.fn()} />);
    });
    expect(chip(tree, "home").props.accessibilityState).toEqual({ selected: false });
    expect(chip(tree, "stock").props.accessibilityState).toEqual({ selected: true });
    expect(JSON.stringify(tree.toJSON())).toContain("Today");
  });

  it("calls onChange with the pressed segment key", () => {
    const onChange = vi.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<SegmentChips idPrefix="inv" segments={[...SEGMENTS]} active="home" onChange={onChange} />);
    });
    act(() => chip(tree, "stock").props.onPress());
    expect(onChange).toHaveBeenCalledWith("stock");
  });
});
