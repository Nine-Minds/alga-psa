import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

const mockGetSession = vi.fn();
const mockRecord = vi.fn();
vi.mock("../api/inventory", () => ({
  getCountSession: (...args: unknown[]) => mockGetSession(...args),
  recordCount: (...args: unknown[]) => mockRecord(...args),
  submitCountSession: vi.fn(),
  lookupInventoryCode: vi.fn(),
}));

const stableApi = { client: { request: vi.fn() } as never, apiKey: "key-1" };
vi.mock("../features/inventory/hooks/useInventoryApi", () => ({
  useInventoryApi: () => stableApi,
}));

vi.mock("../ui/toast/ToastProvider", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { CountSessionScreen } from "./CountSessionScreen";

const session = {
  session_id: "cs-1",
  location_id: "loc-1",
  location_name: "Main Warehouse",
  status: "in_progress",
  lines: [{ service_id: "svc-1", service_name: "Toner", sku: "TNR-1", counted_quantity: 2 }],
};

async function renderScreen(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <CountSessionScreen
        route={{ key: "r", name: "CountSession", params: { sessionId: "cs-1" } } as never}
        navigation={{ goBack: vi.fn() } as never}
      />,
    );
  });
  return tree;
}

describe("CountSessionScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ ok: true, data: { data: session } });
    mockRecord.mockResolvedValue({ ok: true, data: { data: {} } });
  });

  it("increments a line count with the plus button", async () => {
    const tree = await renderScreen();
    const plus = tree.root.findAll((node) => node.props.accessibilityLabel === "inventory-count-increment-svc-1")[0];
    await act(async () => plus.props.onPress());
    expect(mockRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ data: { service_id: "svc-1", counted_quantity: 3 } }),
    );
  });

  it("opens the edit dialog from the quantity chip and saves an exact count", async () => {
    const tree = await renderScreen();
    const chip = tree.root.findAll((node) => node.props.accessibilityLabel === "inventory-count-line-svc-1")[0];
    act(() => chip.props.onPress());

    const input = tree.root.findAll((node) => node.props.accessibilityLabel === "inventory-count-edit-value")[0];
    act(() => input.props.onChangeText("7"));

    const save = tree.root.findAll((node) => node.props.accessibilityLabel === "inventory-count-edit-save")[0];
    await act(async () => save.props.onPress());
    expect(mockRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ data: { service_id: "svc-1", counted_quantity: 7 } }),
    );
  });
});
