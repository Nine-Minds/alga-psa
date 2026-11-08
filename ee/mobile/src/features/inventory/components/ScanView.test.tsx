import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.fn();
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useIsFocused: () => true,
}));

const mockOpenURL = vi.fn();
vi.mock("react-native", async (orig) => {
  const rn = await orig<typeof import("react-native")>();
  return { ...rn, Linking: { ...rn.Linking, openURL: (...a: unknown[]) => mockOpenURL(...a) } };
});

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

const stableApi = {
  client: { request: vi.fn() } as never,
  apiKey: "key-1",
  baseUrl: "https://psa.example.com",
};
const mockWarn = vi.fn();
vi.mock("../../../logging/logger", () => ({
  logger: { warn: (...a: unknown[]) => mockWarn(...a), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
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

  it("lets you enter a code manually when the camera is unavailable", async () => {
    permissionGranted = false;
    canAskAgain = false;
    const tree = renderView();

    // No camera: the manual-entry escape hatch is still offered on the permission screen.
    const enterManually = tree.root.find(
      (node) => node.props.testID === "inventory-scan-enter-manually-permission",
    );
    act(() => enterManually.props.onPress());

    const input = tree.root.find((node) => node.props.accessibilityLabel === "inventory-scan-manual-input");
    act(() => input.props.onChangeText("SN-LIFE-001"));
    await act(async () => {
      tree.root.find((node) => node.props.accessibilityLabel === "inventory-scan-manual-submit").props.onPress();
    });

    expect(mockLookup).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ code: "SN-LIFE-001" }));
  });

  it("offers a visible manual-entry button over the live camera", () => {
    const tree = renderView();
    expect(
      tree.root.findAll((node) => node.props.testID === "inventory-scan-enter-manually").length,
    ).toBeGreaterThan(0);
  });

  describe("record labels", () => {
    const ID = "541b5b63-9e14-47b6-a8f0-0b664f079ed4";
    const scan = async (tree: ReactTestRenderer, data: string) => {
      const camera = tree.root.find((node) => String(node.type) === "CameraView");
      await act(async () => {
        camera.props.onBarcodeScanned({ data });
      });
    };

    it.each([
      [`https://psa.example.com/msp/tickets/${ID}`, "TicketDetail", { ticketId: ID }],
      [`https://psa.example.com/msp/assets/${ID}`, "AssetDetail", { assetId: ID }],
      [`https://PSA.example.com/msp/inventory/units?unitId=${ID}`, "StockUnitDetail", { unitId: ID }],
    ])("opens %s without calling lookup", async (url, screen, params) => {
      const tree = renderView();
      await scan(tree, url);
      expect(mockNavigate).toHaveBeenCalledWith(screen, params);
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it("routes a pasted URL the same way as a scanned one", async () => {
      permissionGranted = false;
      canAskAgain = false;
      const tree = renderView();
      act(() =>
        tree.root.find((n) => n.props.testID === "inventory-scan-enter-manually-permission").props.onPress(),
      );
      act(() =>
        tree.root
          .find((n) => n.props.accessibilityLabel === "inventory-scan-manual-input")
          .props.onChangeText(`https://psa.example.com/msp/assets/${ID}`),
      );
      await act(async () => {
        tree.root.find((n) => n.props.accessibilityLabel === "inventory-scan-manual-submit").props.onPress();
      });
      expect(mockNavigate).toHaveBeenCalledWith("AssetDetail", { assetId: ID });
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it("shows the different-server message for a foreign URL and makes no request", async () => {
      const tree = renderView();
      await scan(tree, `https://other.example.org/msp/assets/${ID}`);
      expect(mockLookup).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockOpenURL).not.toHaveBeenCalled();
      tree.root.find((n) => n.props.testID === "inventory-scan-record-notice");
      expect(JSON.stringify(tree.toJSON())).toContain("different Alga server");
      expect(mockWarn).toHaveBeenCalledWith(expect.any(String), { host: "other.example.org" });
      expect(JSON.stringify(mockWarn.mock.calls)).not.toContain(ID);
    });

    it("opens project/RMA labels in the browser on the connected server, not the scanned origin", async () => {
      const tree = renderView();
      await scan(tree, `http://PSA.example.com:80/msp/inventory/rma?rmaId=${ID}`);
      expect(mockNavigate).not.toHaveBeenCalled();
      await act(async () => {
        tree.root.find((n) => n.props.testID === "inventory-scan-open-in-browser").props.onPress();
      });
      expect(mockOpenURL).toHaveBeenCalledWith(`https://psa.example.com/msp/inventory/rma?rmaId=${ID}`);
    });

    it("keeps today's lookup for plain codes and non-record URLs", async () => {
      const tree = renderView();
      await scan(tree, "SN-123");
      expect(mockLookup).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ code: "SN-123" }));
    });
  });
});
