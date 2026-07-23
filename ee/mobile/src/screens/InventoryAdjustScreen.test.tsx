import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

const mockAdjust = vi.fn();
vi.mock("../api/inventory", () => ({
  adjustStock: (...args: unknown[]) => mockAdjust(...args),
  listStockLocations: vi.fn(async () => ({ ok: true, data: { data: [{ location_id: "loc-1", name: "Main", location_type: "warehouse", is_default: true }] } })),
}));

const stableApi = { client: { request: vi.fn() } as never, apiKey: "key-1" };
vi.mock("../features/inventory/hooks/useInventoryApi", () => ({
  useInventoryApi: () => stableApi,
}));

vi.mock("../ui/toast/ToastProvider", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { InventoryAdjustScreen } from "./InventoryAdjustScreen";

function renderScreen(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <InventoryAdjustScreen
        route={{ key: "r", name: "InventoryAdjust", params: { serviceId: "svc-1", serviceName: "Phone" } } as never}
        navigation={{ goBack: vi.fn() } as never}
      />,
    );
  });
  return tree;
}

describe("InventoryAdjustScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps submit disabled until a reason is provided", async () => {
    const tree = renderScreen();
    await act(async () => {});

    const delta = tree.root.find((node) => node.props.accessibilityLabel === "inventory-adjust-delta");
    act(() => delta.props.onChangeText("-3"));

    let submit = tree.root.find((node) => node.props.accessibilityLabel === "inventory-adjust-submit");
    expect(submit.props.disabled).toBe(true);

    const reason = tree.root.find((node) => node.props.accessibilityLabel === "inventory-adjust-reason");
    act(() => reason.props.onChangeText("damaged in transit"));

    submit = tree.root.find((node) => node.props.accessibilityLabel === "inventory-adjust-submit");
    expect(submit.props.disabled).toBe(false);
  });

  it("renders the no-access state on a 403", async () => {
    mockAdjust.mockResolvedValue({ ok: false, error: { kind: "permission", message: "denied" } });
    const tree = renderScreen();
    await act(async () => {});

    act(() => tree.root.find((node) => node.props.accessibilityLabel === "inventory-adjust-delta").props.onChangeText("-1"));
    act(() => tree.root.find((node) => node.props.accessibilityLabel === "inventory-adjust-reason").props.onChangeText("lost"));
    await act(async () =>
      tree.root.find((node) => node.props.accessibilityLabel === "inventory-adjust-submit").props.onPress(),
    );

    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "inventory-adjust-no-access")).toHaveLength(1);
  });
});
