import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, vars?: Record<string, unknown>) => {
      if (typeof fallback === "string") {
        const values = vars ?? {};
        return fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ""));
      }
      return _key;
    },
  }),
}));

const mockListClients = vi.fn();
vi.mock("../../../api/clients", () => ({
  listClients: (...args: unknown[]) => mockListClients(...args),
}));

const mockCreateAsset = vi.fn();
vi.mock("../../../api/assets", () => ({
  createAsset: (...args: unknown[]) => mockCreateAsset(...args),
}));

import { RegisterAssetModal } from "./RegisterAssetModal";

const ok = <T,>(data: T) => ({ ok: true as const, status: 200, data });
const apiClient = { request: vi.fn() } as never;

function hosts(tree: ReactTestRenderer, testID: string): ReactTestInstance[] {
  return tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === testID);
}

function byLabel(tree: ReactTestRenderer, label: string): ReactTestInstance[] {
  return tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === label);
}

async function renderModal(onCreated = vi.fn()) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <RegisterAssetModal
        visible
        client={apiClient}
        apiKey="key"
        code="SN-FIELD-42"
        onClose={vi.fn()}
        onCreated={onCreated}
      />,
    );
  });
  return { tree, onCreated };
}

describe("RegisterAssetModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListClients.mockResolvedValue(
      ok({ data: [{ client_id: "cl-1", client_name: "Emerald City" }], pagination: { page: 1, limit: 25, total: 1, totalPages: 1 } }),
    );
    mockCreateAsset.mockResolvedValue(ok({ data: { asset_id: "asset-77" } }));
  });

  it("registers the scanned code as the client's asset", async () => {
    const { tree, onCreated } = await renderModal();

    await act(async () => hosts(tree, "inventory-register-client-cl-1")[0].props.onPress());
    act(() => byLabel(tree, "inventory-register-name")[0].props.onChangeText("Front desk PC"));
    await act(async () => hosts(tree, "inventory-register-type-printer")[0].props.onPress());
    await act(async () => byLabel(tree, "inventory-register-submit")[0].props.onPress());

    expect(mockCreateAsset).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: {
          client_id: "cl-1",
          asset_type: "printer",
          asset_tag: "SN-FIELD-42",
          serial_number: "SN-FIELD-42",
          name: "Front desk PC",
          status: "active",
        },
      }),
    );
    expect(onCreated).toHaveBeenCalledWith("asset-77", "Front desk PC");
  });

  it("T128 registers into an audit's scope without asking for the client", async () => {
    let tree!: ReactTestRenderer;
    const onCreated = vi.fn();
    await act(async () => {
      tree = create(
        <RegisterAssetModal
          visible
          client={apiClient}
          apiKey="key"
          code="SN-FIELD-42"
          clientId="cl-1"
          clientName="Emerald City"
          locationId="loc-1"
          locationName="Main office"
          onClose={vi.fn()}
          onCreated={onCreated}
        />,
      );
    });

    expect(mockListClients).not.toHaveBeenCalled();
    expect(hosts(tree, "inventory-register-change-client")).toHaveLength(0);

    act(() => byLabel(tree, "inventory-register-name")[0].props.onChangeText("Hall switch"));
    await act(async () => byLabel(tree, "inventory-register-submit")[0].props.onPress());

    expect(mockCreateAsset).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({ client_id: "cl-1", location_id: "loc-1" }),
      }),
    );
    expect(onCreated).toHaveBeenCalledWith("asset-77", "Hall switch");
  });

  it("keeps submit disabled without a name and surfaces server errors", async () => {
    mockCreateAsset.mockResolvedValue({
      ok: false,
      status: 403,
      error: { kind: "forbidden", message: "Permission denied: Cannot create assets", status: 403 },
    });
    const { tree, onCreated } = await renderModal();
    await act(async () => hosts(tree, "inventory-register-client-cl-1")[0].props.onPress());
    expect(byLabel(tree, "inventory-register-submit")[0].props.disabled).toBe(true);
    act(() => byLabel(tree, "inventory-register-name")[0].props.onChangeText("X"));
    await act(async () => byLabel(tree, "inventory-register-submit")[0].props.onPress());
    expect(onCreated).not.toHaveBeenCalled();
    expect(hosts(tree, "inventory-register-error")[0].children.join("")).toContain("Permission denied");
  });
});
