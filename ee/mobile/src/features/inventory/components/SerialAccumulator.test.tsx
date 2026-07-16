import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("expo-camera", () => ({
  CameraView: (props: Record<string, unknown>) =>
    React.createElement("CameraView", props, props.children as React.ReactNode),
  useCameraPermissions: () => [{ granted: true }, vi.fn(async () => ({ granted: true }))],
}));

import { SerialAccumulator } from "./SerialAccumulator";

function renderAccumulator(target: number, onDone = vi.fn(), onCancel = vi.fn()): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<SerialAccumulator visible target={target} onDone={onDone} onCancel={onCancel} />);
  });
  return tree;
}

function scan(tree: ReactTestRenderer, code: string) {
  const camera = tree.root.find((node) => String(node.type) === "CameraView");
  act(() => {
    camera.props.onBarcodeScanned({ data: code });
  });
}

describe("SerialAccumulator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("builds a chip list from distinct scans, rejects duplicates, and submits exactly the chips", () => {
    const onDone = vi.fn();
    const tree = renderAccumulator(3, onDone);

    scan(tree, "SN-A");
    act(() => { vi.advanceTimersByTime(1300); });
    scan(tree, "SN-B");
    act(() => { vi.advanceTimersByTime(1300); });
    scan(tree, "SN-B");
    act(() => { vi.advanceTimersByTime(1300); });

    expect(
      tree.root.findAll((node) => typeof node.type === "string" && typeof node.props.testID === "string" && node.props.testID.startsWith("inventory-serial-chip-")),
    ).toHaveLength(2);
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "inventory-serials-duplicate")).toHaveLength(1);

    const manualInput = tree.root.find((node) => node.props.accessibilityLabel === "inventory-serials-manual-input");
    act(() => manualInput.props.onChangeText("SN-C"));
    const addButton = tree.root.find((node) => node.props.testID === "inventory-serials-manual-add");
    act(() => addButton.props.onPress());

    const done = tree.root.find((node) => node.props.accessibilityLabel === "inventory-serials-done");
    act(() => done.props.onPress());
    expect(onDone).toHaveBeenCalledWith(["SN-A", "SN-B", "SN-C"]);
    vi.useRealTimers();
  });

  it("disables done until the chip count matches the target", () => {
    const tree = renderAccumulator(2);
    scan(tree, "SN-A");
    const done = tree.root.find((node) => node.props.accessibilityLabel === "inventory-serials-done");
    expect(done.props.disabled).toBe(true);
    vi.useRealTimers();
  });
});
