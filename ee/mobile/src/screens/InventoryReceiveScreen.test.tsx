import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

const mockReceive = vi.fn();
vi.mock("../api/inventory", () => ({
  receiveStock: (...args: unknown[]) => mockReceive(...args),
  listStockLocations: vi.fn(async () => ({ ok: true, data: { data: [{ location_id: "loc-1", name: "Main", location_type: "warehouse", is_default: true }] } })),
}));

const stableApi = { client: { request: vi.fn() } as never, apiKey: "key-1" };
vi.mock("../features/inventory/hooks/useInventoryApi", () => ({
  useInventoryApi: () => stableApi,
}));

vi.mock("../features/inventory/components/SerialAccumulator", () => ({
  SerialAccumulator: (props: Record<string, unknown>) =>
    React.createElement("SerialAccumulator", props),
}));

vi.mock("../ui/toast/ToastProvider", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { InventoryReceiveScreen } from "./InventoryReceiveScreen";

function renderScreen(params: { serviceId?: string; serviceName?: string; isSerialized?: boolean }): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <InventoryReceiveScreen
        route={{ key: "r", name: "InventoryReceive", params } as never}
        navigation={{ goBack: vi.fn() } as never}
      />,
    );
  });
  return tree;
}

describe("InventoryReceiveScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReceive.mockResolvedValue({ ok: true, data: { data: { received: 1 } } });
  });

  it("blocks serialized submit until serial count equals quantity, then submits serials", async () => {
    const tree = renderScreen({ serviceId: "svc-1", serviceName: "Phone", isSerialized: true });
    await act(async () => {});

    const quantity = tree.root.find((node) => node.props.accessibilityLabel === "inventory-receive-quantity");
    act(() => quantity.props.onChangeText("2"));

    const submit = tree.root.find((node) => node.props.accessibilityLabel === "inventory-receive-submit");
    expect(submit.props.disabled).toBe(true);

    const accumulator = tree.root.find((node) => String(node.type) === "SerialAccumulator");
    act(() => accumulator.props.onDone(["SN-1", "SN-2"]));

    const submitAfter = tree.root.find((node) => node.props.accessibilityLabel === "inventory-receive-submit");
    expect(submitAfter.props.disabled).toBe(false);

    await act(async () => submitAfter.props.onPress());
    expect(mockReceive).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          service_id: "svc-1",
          quantity: 2,
          serials: [{ serial_number: "SN-1" }, { serial_number: "SN-2" }],
        }),
      }),
    );
  });

  it("submits quantity only for non-serialized products", async () => {
    const tree = renderScreen({ serviceId: "svc-2", serviceName: "Cable", isSerialized: false });
    await act(async () => {});

    const quantity = tree.root.find((node) => node.props.accessibilityLabel === "inventory-receive-quantity");
    act(() => quantity.props.onChangeText("5"));

    const submit = tree.root.find((node) => node.props.accessibilityLabel === "inventory-receive-submit");
    expect(submit.props.disabled).toBe(false);
    await act(async () => submit.props.onPress());
    expect(mockReceive).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({ quantity: 5, serials: undefined }),
      }),
    );
  });
});
