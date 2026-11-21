import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, opts?: Record<string, unknown>) => {
      let out = fallback ?? _key;
      for (const [k, v] of Object.entries(opts ?? {})) out = out.replace(`{{${k}}}`, String(v));
      return out;
    },
  }),
}));

const mocks = vi.hoisted(() => ({ alert: vi.fn() }));
vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  return { ...actual, Alert: { alert: (...args: unknown[]) => mocks.alert(...args) } };
});

const mockGetPo = vi.fn();
const mockReceiveLine = vi.fn();
vi.mock("../api/inventory", () => ({
  getPurchaseOrder: (...args: unknown[]) => mockGetPo(...args),
  receivePurchaseOrderLine: (...args: unknown[]) => mockReceiveLine(...args),
}));

const api = { current: { client: { request: vi.fn() } as never, apiKey: "key-1" as string | null } };
vi.mock("../features/inventory/hooks/useInventoryApi", () => ({ useInventoryApi: () => api.current }));

vi.mock("../features/inventory/components/LocationPickerField", () => ({
  LocationPickerField: (props: Record<string, unknown>) => React.createElement("LocationPickerField", props),
}));
vi.mock("../features/inventory/components/SerialAccumulator", () => ({
  SerialAccumulator: (props: Record<string, unknown>) => React.createElement("SerialAccumulator", props),
}));

const mockShowToast = vi.fn();
vi.mock("../ui/toast/ToastProvider", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

import { PurchaseOrderDetailScreen } from "./PurchaseOrderDetailScreen";

const text = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((n) => String(n.type) === "Text")
    .map((n) => [].concat(n.props.children ?? []).join(""))
    .join("\n");
const host = (tree: ReactTestRenderer, pred: (p: Record<string, unknown>) => boolean) =>
  tree.root.findAll((n) => typeof String(n.type) === "string" && pred(n.props));
const receiveLink = (tree: ReactTestRenderer, id: string) =>
  tree.root.find((n) => String(n.type) === "Text" && n.props.testID === `inventory-po-line-receive-${id}`);
const qtyInput = (tree: ReactTestRenderer, id: string) =>
  tree.root.find((n) => String(n.type) === "TextInput" && n.props.accessibilityLabel === `inventory-po-line-qty-${id}`);
const confirm = (tree: ReactTestRenderer, id: string) =>
  host(tree, (p) => p.accessibilityLabel === `inventory-po-line-confirm-${id}`)[0];
const serials = (tree: ReactTestRenderer) => tree.root.find((n) => String(n.type) === "SerialAccumulator");

const PO = {
  po_id: "po-1",
  po_number: "PO-0001",
  vendor_name: "Ingram",
  status: "partially_received",
  lines: [
    { po_line_id: "l-1", service_id: "svc-1", service_name: "Toner", sku: "TN-1", quantity_ordered: 5, quantity_received: 2, is_serialized: false },
    { po_line_id: "l-2", service_id: "svc-2", quantity_ordered: 2, quantity_received: 0, is_serialized: true },
    { po_line_id: "l-3", service_id: "svc-3", service_name: "Cable", quantity_ordered: 1, quantity_received: 1, is_serialized: false },
  ],
};

async function render() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <PurchaseOrderDetailScreen
        route={{ key: "r", name: "PurchaseOrderDetail", params: { poId: "po-1", poNumber: "PO-0001" } } as never}
        navigation={{} as never}
      />,
    );
  });
  return tree;
}

describe("PurchaseOrderDetailScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.current = { client: { request: vi.fn() } as never, apiKey: "key-1" };
    mockGetPo.mockResolvedValue({ ok: true, data: { data: PO } });
    mockReceiveLine.mockResolvedValue({ ok: true, data: {} });
  });

  it("renders header, vendor and line progress; done lines have no receive action", async () => {
    const tree = await render();
    expect(mockGetPo).toHaveBeenCalledWith(api.current.client, expect.objectContaining({ apiKey: "key-1", poId: "po-1" }));
    const all = text(tree);
    expect(all).toContain("PO-0001");
    expect(all).toContain("Ingram");
    expect(all).toContain("2 of 5 received · TN-1");
    expect(all).toContain("svc-2");
    expect(host(tree, (p) => p.testID === "inventory-po-line-receive-l-3")).toHaveLength(0);
    expect(host(tree, (p) => p.testID === "inventory-po-line-receive-l-1")).not.toHaveLength(0);
  });

  it("receives a non-serialized line with the chosen quantity and location", async () => {
    const tree = await render();
    act(() => tree.root.find((n) => String(n.type) === "LocationPickerField").props.onChange("loc-9"));
    act(() => receiveLink(tree, "l-1").props.onPress());
    expect(qtyInput(tree, "l-1").props.value).toBe("3");
    act(() => qtyInput(tree, "l-1").props.onChangeText("2"));
    await act(async () => confirm(tree, "l-1").props.onPress());
    expect(mockReceiveLine).toHaveBeenCalledWith(api.current.client, {
      apiKey: "key-1",
      poId: "po-1",
      lineId: "l-1",
      data: { quantity: 2, location_id: "loc-9", serials: undefined },
    });
    expect(mockShowToast).toHaveBeenCalledWith({ tone: "success", message: "Received" });
    expect(mockGetPo).toHaveBeenCalledTimes(2);
    expect(host(tree, (p) => p.accessibilityLabel === "inventory-po-line-qty-l-1")).toHaveLength(0);
  });

  it("ignores invalid quantities", async () => {
    const tree = await render();
    act(() => receiveLink(tree, "l-1").props.onPress());
    act(() => qtyInput(tree, "l-1").props.onChangeText(""));
    await act(async () => confirm(tree, "l-1").props.onPress());
    expect(mockReceiveLine).not.toHaveBeenCalled();
  });

  it("asks before over-receiving and submits only on confirm", async () => {
    const tree = await render();
    act(() => receiveLink(tree, "l-1").props.onPress());
    act(() => qtyInput(tree, "l-1").props.onChangeText("9"));
    await act(async () => confirm(tree, "l-1").props.onPress());
    expect(mockReceiveLine).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    const [title, , buttons] = mocks.alert.mock.calls[0];
    expect(title).toBe("This exceeds the remaining quantity on the line.");
    expect(buttons[0]).toMatchObject({ style: "cancel" });
    await act(async () => buttons[1].onPress());
    expect(mockReceiveLine).toHaveBeenCalledWith(api.current.client, expect.objectContaining({ data: expect.objectContaining({ quantity: 9, location_id: undefined }) }));
  });

  it("serialized lines go through the serial accumulator", async () => {
    const tree = await render();
    expect(serials(tree).props.visible).toBe(false);
    act(() => receiveLink(tree, "l-2").props.onPress());
    expect(serials(tree).props.visible).toBe(true);
    expect(serials(tree).props.target).toBe(2);
    await act(async () => serials(tree).props.onDone(["SN-1", "SN-2"]));
    expect(mockReceiveLine).toHaveBeenCalledWith(
      api.current.client,
      expect.objectContaining({
        lineId: "l-2",
        data: { quantity: 2, location_id: undefined, serials: [{ serial_number: "SN-1" }, { serial_number: "SN-2" }] },
      }),
    );
    expect(serials(tree).props.visible).toBe(false);
  });

  it("cancelling the accumulator closes it without receiving", async () => {
    const tree = await render();
    act(() => receiveLink(tree, "l-2").props.onPress());
    act(() => serials(tree).props.onCancel());
    expect(serials(tree).props.visible).toBe(false);
    expect(serials(tree).props.target).toBeUndefined();
    act(() => serials(tree).props.onDone(["x"]));
    expect(mockReceiveLine).not.toHaveBeenCalled();
  });

  it("toasts permission and server failures", async () => {
    const tree = await render();
    mockReceiveLine.mockResolvedValueOnce({ ok: false, error: { kind: "permission" } });
    act(() => receiveLink(tree, "l-1").props.onPress());
    await act(async () => confirm(tree, "l-1").props.onPress());
    expect(mockShowToast).toHaveBeenLastCalledWith({ tone: "error", message: "You can't adjust stock at this location." });
    mockReceiveLine.mockResolvedValueOnce({ ok: false, error: { kind: "server", message: "Line closed" } });
    await act(async () => confirm(tree, "l-1").props.onPress());
    expect(mockShowToast).toHaveBeenLastCalledWith({ tone: "error", message: "Line closed" });
    mockReceiveLine.mockResolvedValueOnce({ ok: false, error: { kind: "server" } });
    await act(async () => confirm(tree, "l-1").props.onPress());
    expect(mockShowToast).toHaveBeenLastCalledWith({ tone: "error", message: "Lookup failed. Try again." });
  });

  it("shows error with retry, and stays loading on cancel", async () => {
    mockGetPo.mockResolvedValueOnce({ ok: false, error: { kind: "server" } });
    const tree = await render();
    expect(text(tree)).toContain("Retry");
    await act(async () => tree.root.find((n) => String(n.type) === "Text" && n.props.children === "Retry").props.onPress());
    expect(text(tree)).toContain("PO-0001");
    mockGetPo.mockResolvedValueOnce({ ok: false, error: { kind: "canceled" } });
    expect(text(await render())).toContain("Loading...");
  });

  it("does not fetch without a client", async () => {
    api.current = { client: null as never, apiKey: null };
    await render();
    expect(mockGetPo).not.toHaveBeenCalled();
  });
});
