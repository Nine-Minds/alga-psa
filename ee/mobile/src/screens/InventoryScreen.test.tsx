import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("../features/inventory/components/HomeView", () => ({
  HomeView: (props: { onOpenSegment: (s: string) => void }) => React.createElement("HomeView", props),
}));
vi.mock("../features/inventory/components/ScanView", async () => {
  const R = await import("react");
  return { ScanView: () => R.createElement("ScanView") };
});
vi.mock("../features/inventory/components/StockView", async () => {
  const R = await import("react");
  return { StockView: () => R.createElement("StockView") };
});
vi.mock("../features/inventory/components/CountsView", async () => {
  const R = await import("react");
  return { CountsView: () => R.createElement("CountsView") };
});
vi.mock("../features/inventory/components/PosView", async () => {
  const R = await import("react");
  return { PosView: () => R.createElement("PosView") };
});
vi.mock("../features/inventory/components/TransfersView", async () => {
  const R = await import("react");
  return { TransfersView: () => R.createElement("TransfersView") };
});

import { InventoryScreen } from "./InventoryScreen";

const VIEWS = ["HomeView", "ScanView", "StockView", "CountsView", "PosView", "TransfersView"];
const visible = (tree: ReactTestRenderer) => VIEWS.filter((v) => tree.root.findAll((n) => n.type === v).length > 0);
const chip = (tree: ReactTestRenderer, key: string) =>
  tree.root.find((n) => String(n.type) === "Pressable" && n.props.testID === `inventory-segment-${key}`);

function render(segment?: string) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<InventoryScreen {...((segment ? { route: { params: { segment } } } : {}) as unknown as React.ComponentProps<typeof InventoryScreen>)} />);
  });
  return tree;
}

describe("InventoryScreen", () => {
  it("defaults to the home segment", () => {
    const tree = render();
    expect(visible(tree)).toEqual(["HomeView"]);
    expect(chip(tree, "home").props.accessibilityState).toEqual({ selected: true });
  });

  it.each([
    ["scan", "ScanView"],
    ["stock", "StockView"],
    ["counts", "CountsView"],
    ["pos", "PosView"],
    ["transfers", "TransfersView"],
  ])("switches to %s when its chip is pressed", (key, view) => {
    const tree = render();
    act(() => chip(tree, key).props.onPress());
    expect(visible(tree)).toEqual([view]);
  });

  it("opens the segment requested by the route and follows later route changes", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<InventoryScreen {...({ route: { params: { segment: "scan" } } } as unknown as React.ComponentProps<typeof InventoryScreen>)} />);
    });
    expect(visible(tree)).toEqual(["ScanView"]);
    act(() => tree.update(<InventoryScreen {...({ route: { params: { segment: "pos" } } } as unknown as React.ComponentProps<typeof InventoryScreen>)} />));
    expect(visible(tree)).toEqual(["PosView"]);
  });

  it("lets HomeView switch segments", () => {
    const tree = render();
    act(() => tree.root.find((n) => String(n.type) === "HomeView").props.onOpenSegment("counts"));
    expect(visible(tree)).toEqual(["CountsView"]);
  });
});
