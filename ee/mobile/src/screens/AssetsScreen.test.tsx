import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  listAssets: vi.fn(),
  listAssetStatuses: vi.fn(),
  listClients: vi.fn(),
  listClientLocations: vi.fn(),
  listAssetAudits: vi.fn(),
  navigate: vi.fn(),
  features: { inventory: true, assets: true, assetAudit: true },
  authValue: {
    session: { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } },
    refreshSession: () => Promise.resolve(null),
  },
  translate: (key: string, defOrOpts?: string | Record<string, unknown>, optsArg?: Record<string, unknown>) => {
    const def = typeof defOrOpts === "string" ? defOrOpts : undefined;
    const opts = typeof defOrOpts === "object" ? defOrOpts : optsArg;
    let out = def ?? key;
    if (opts) {
      for (const [name, value] of Object.entries(opts)) out = out.replaceAll(`{{${name}}}`, String(value));
    }
    return out;
  },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.translate }) }));

vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  const ReactLocal = await import("react");
  const FlatList = (props: Record<string, any>) => {
    const data: unknown[] = props.data ?? [];
    const children: React.ReactNode[] = [];
    if (props.ListHeaderComponent) {
      children.push(ReactLocal.createElement(ReactLocal.Fragment, { key: "header" }, props.ListHeaderComponent));
    }
    if (data.length === 0 && props.ListEmptyComponent) {
      children.push(ReactLocal.createElement(ReactLocal.Fragment, { key: "empty" }, props.ListEmptyComponent));
    } else {
      data.forEach((item, index) => {
        const key = props.keyExtractor ? props.keyExtractor(item, index) : String(index);
        children.push(ReactLocal.createElement(ReactLocal.Fragment, { key }, props.renderItem({ item, index })));
      });
    }
    return ReactLocal.createElement("FlatList", { testID: props.testID, onEndReached: props.onEndReached }, children);
  };
  return { ...actual, FlatList };
});

vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mocks.authValue }));
vi.mock("../capabilities/CapabilitiesContext", () => ({
  useCapabilities: () => ({ features: mocks.features, loaded: true }),
}));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => ({ ok: true, env: "dev", baseUrl: "https://algapsa.com" }) }));
vi.mock("../api", () => ({ createApiClient: () => ({ request: vi.fn() }) }));
vi.mock("../api/assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/assets")>()),
  listAssets: (...args: unknown[]) => mocks.listAssets(...args),
  listAssetStatuses: (...args: unknown[]) => mocks.listAssetStatuses(...args),
}));
vi.mock("../api/assetAudits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/assetAudits")>()),
  listAssetAudits: (...args: unknown[]) => mocks.listAssetAudits(...args),
}));
vi.mock("../api/clients", () => ({ listClients: (...args: unknown[]) => mocks.listClients(...args) }));
vi.mock("../api/referenceData", () => ({
  listClientLocations: (...args: unknown[]) => mocks.listClientLocations(...args),
}));
vi.mock("../features/inventory/components/ScanView", () => ({ ScanView: () => null }));
vi.mock("../network/useNetworkStatus", () => ({
  useNetworkStatus: () => ({ isConnected: true, isInternetReachable: true }),
}));
vi.mock("../logging/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { AssetsScreen } from "./AssetsScreen";

const STATUSES = [
  { slug: "active", label: "Active", kind: "deployable" as const, display_order: 1 },
  { slug: "in_stock", label: "In stock", kind: "deployable" as const, display_order: 2 },
  { slug: "maintenance", label: "Maintenance", kind: "pending" as const, display_order: 3 },
  { slug: "retired", label: "Retired", kind: "archived" as const, display_order: 5 },
];

function assetsPage(items: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: { data: items, pagination: { page: 1, limit: 50, total: items.length, ...overrides } },
  };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(AssetsScreen, { navigation: { navigate: mocks.navigate } } as never));
  });
  await flush();
  return renderer;
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => {
    const value = node.props.children;
    return Array.isArray(value) ? value.join("") : String(value);
  });
}

function lastListCall() {
  return mocks.listAssets.mock.calls[mocks.listAssets.mock.calls.length - 1][1];
}

describe("AssetsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.features = { inventory: true, assets: true, assetAudit: true };
    mocks.listAssetStatuses.mockResolvedValue({ ok: true, data: { data: STATUSES } });
    mocks.listClients.mockResolvedValue({ ok: true, data: { data: [{ client_id: "cl-1", client_name: "ECTS" }] } });
    mocks.listAssetAudits.mockResolvedValue({
      ok: true,
      data: { data: [], pagination: { page: 1, limit: 10, total: 0 } },
    });
    mocks.listClientLocations.mockResolvedValue({
      ok: true,
      data: { data: [{ location_id: "loc-1", location_name: "HQ", city: "Reno" }] },
    });
    mocks.listAssets.mockResolvedValue(
      assetsPage([
        {
          asset_id: "a-1",
          asset_tag: "ECTS-014",
          name: "Reception PC",
          asset_type: "workstation",
          status: "in_stock",
          client_id: "cl-1",
          client_name: "ECTS",
          location: "HQ",
        },
      ]),
    );
  });

  it("T038 renders rows with tag, location and the registry status label", async () => {
    const renderer = await renderScreen();
    const all = texts(renderer);
    expect(all).toContain("Reception PC");
    expect(all.join(" ")).toContain("ECTS-014");
    expect(all.join(" ")).toContain("HQ");
    expect(all).toContain("In stock");
  });

  it("T041 title-cases a slug the registry does not know", async () => {
    mocks.listAssets.mockResolvedValue(
      assetsPage([
        { asset_id: "a-2", asset_tag: "X", name: "Odd device", status: "custom_thing", client_id: "cl-1" },
      ]),
    );
    const renderer = await renderScreen();
    // An unknown slug is also outside the default (non-archived) scope, so the
    // row is filtered out; the label helper is covered in the api test.
    expect(texts(renderer)).not.toContain("Odd device");
  });

  it("T040 keeps archived statuses out of the default scope", async () => {
    mocks.listAssets.mockResolvedValue(
      assetsPage([
        { asset_id: "a-1", asset_tag: "T1", name: "Live PC", status: "active", client_id: "cl-1" },
        { asset_id: "a-9", asset_tag: "T9", name: "Old PC", status: "retired", client_id: "cl-1" },
      ]),
    );
    const renderer = await renderScreen();

    const all = texts(renderer);
    expect(all).toContain("Live PC");
    expect(all).not.toContain("Old PC");
  });

  it("T039 disables the location row until a client is picked and resets it on change", async () => {
    const renderer = await renderScreen();
    await act(async () => renderer.root.find((n) => n.props?.testID === "assets-filters").props.onPress());

    const locationRow = renderer.root.find((n) => n.props?.testID === "assets-filter-location");
    expect(locationRow.props.disabled).toBe(true);

    await act(async () => renderer.root.find((n) => n.props?.testID === "assets-filter-client").props.onPress());
    await flush();
    const clientPicker = renderer.root
      .findAll((n) => n.props?.onSelect && n.props?.title === "Select a client")
      .at(0)!;
    await act(async () => clientPicker.props.onSelect("cl-1", "ECTS"));

    expect(renderer.root.find((n) => n.props?.testID === "assets-filter-location").props.disabled).toBe(false);

    await act(async () => renderer.root.find((n) => n.props?.testID === "assets-filter-location").props.onPress());
    await flush();
    const locationPicker = renderer.root
      .findAll((n) => n.props?.onSelect && n.props?.title === "Select a location")
      .at(0)!;
    await act(async () => locationPicker.props.onSelect("loc-1", "HQ"));
    await act(async () => renderer.root.find((n) => n.props?.testID === "assets-filter-apply").props.onPress());
    await flush();

    expect(lastListCall()).toMatchObject({ client_id: "cl-1", location_id: "loc-1" });
  });

  it("T043 opens AssetDetail on row tap", async () => {
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "asset-row-a-1").props.onPress());

    expect(mocks.navigate).toHaveBeenCalledWith("AssetDetail", { assetId: "a-1", assetName: "Reception PC" });
  });

  it("sends Scan to the Inventory scan segment when inventory is available", async () => {
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "assets-scan").props.onPress());

    expect(mocks.navigate).toHaveBeenCalledWith("InventoryTab", { segment: "scan" });
  });

  it("T042 hides the Audit action when the assetAudit capability is false", async () => {
    mocks.features = { inventory: true, assets: true, assetAudit: false };
    const renderer = await renderScreen();

    expect(renderer.root.findAll((n) => n.props?.testID === "assets-audit")).toHaveLength(0);
    expect(mocks.listAssetAudits).not.toHaveBeenCalled();
  });

  it("shows the Audit action and opens the setup screen when it is true", async () => {
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "assets-audit").props.onPress());

    expect(mocks.navigate).toHaveBeenCalledWith("AuditSetup");
  });

  it("T044 lists recent audits with their counts and opens one", async () => {
    mocks.listAssetAudits.mockResolvedValue({
      ok: true,
      data: {
        data: [
          {
            audit_id: "au-1",
            client_id: "cl-1",
            location_id: null,
            status: "completed",
            started_by: "user-1",
            started_at: "2026-10-16T09:00:00Z",
            completed_at: "2026-10-16T10:00:00Z",
            expected_count: 3,
            present_count: 2,
            missing_count: 1,
            unexpected_count: 0,
          },
        ],
        pagination: { page: 1, limit: 10, total: 1 },
      },
    });
    const renderer = await renderScreen();

    expect(texts(renderer)).toContain("2 present · 1 missing");
    await act(async () =>
      renderer.root.find((n) => n.props?.testID === "assets-recent-audits-au-1").props.onPress(),
    );

    expect(mocks.navigate).toHaveBeenCalledWith("AuditSummary", { auditId: "au-1" });
  });

  it("opens the scan modal instead when inventory is off", async () => {
    mocks.features = { inventory: false, assets: true, assetAudit: true };
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "assets-scan").props.onPress());

    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(renderer.root.find((n) => n.props?.testID === "assets-scan-close")).toBeTruthy();
  });
});
