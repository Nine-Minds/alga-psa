import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.fn();
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useIsFocused: () => true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

let permissionGranted = true;
let canAskAgain = true;
vi.mock("expo-camera", () => ({
  CameraView: (props: Record<string, unknown>) =>
    React.createElement("CameraView", props, props.children as React.ReactNode),
  useCameraPermissions: () => [
    { granted: permissionGranted, canAskAgain },
    vi.fn(async () => ({ granted: permissionGranted })),
  ],
}));

const mockLookup = vi.fn();
vi.mock("../../../api/inventory", () => ({
  lookupInventoryCode: (...args: unknown[]) => mockLookup(...args),
}));

const stableApi = { client: { request: vi.fn() } as never, apiKey: "key-1" };
vi.mock("../hooks/useInventoryApi", () => ({
  useInventoryApi: () => stableApi,
}));

vi.mock("../../../ui/toast/ToastProvider", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../../../api/materials", () => ({
  listProducts: vi.fn(async () => ({ ok: true, data: { data: [] } })),
  setProductBarcode: vi.fn(async () => ({ ok: true, data: { data: {} } })),
}));

import { ScanView } from "./ScanView";

function renderView(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<ScanView />);
  });
  return tree;
}

describe("ScanView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissionGranted = true;
    canAskAgain = true;
    mockLookup.mockResolvedValue({ ok: true, data: { data: { type: "none", candidates: [] } } });
  });

  it("collapses rapid duplicate reads into one lookup", async () => {
    const tree = renderView();
    const camera = tree.root.find((node) => String(node.type) === "CameraView");
    await act(async () => {
      camera.props.onBarcodeScanned({ data: "SN-123" });
    });
    const cameraAfter = tree.root.find((node) => String(node.type) === "CameraView");
    await act(async () => {
      cameraAfter.props.onBarcodeScanned?.({ data: "SN-123" });
    });
    expect(mockLookup).toHaveBeenCalledTimes(1);
  });

  it("renders permission-denied state with settings action when cannot ask again", () => {
    permissionGranted = false;
    canAskAgain = false;
    const tree = renderView();
    expect(
      tree.root.findAll((node) => node.props.accessibilityLabel === "inventory-scan-open-settings").length,
    ).toBeGreaterThan(0);
  });
});
