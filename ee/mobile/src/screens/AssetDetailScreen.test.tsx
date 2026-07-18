import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

const mockGetAsset = vi.fn();
const mockGetMaintenance = vi.fn();
const mockGetHistory = vi.fn();
const mockGetTickets = vi.fn();
const mockGetSoftware = vi.fn();
const mockRecordMaintenance = vi.fn();
const mockLink = vi.fn();
const mockCreate = vi.fn();
vi.mock("../api/assets", () => ({
  getAsset: (...args: unknown[]) => mockGetAsset(...args),
  getAssetMaintenance: (...args: unknown[]) => mockGetMaintenance(...args),
  getAssetHistory: (...args: unknown[]) => mockGetHistory(...args),
  getAssetTickets: (...args: unknown[]) => mockGetTickets(...args),
  getAssetSoftware: (...args: unknown[]) => mockGetSoftware(...args),
  recordAssetMaintenance: (...args: unknown[]) => mockRecordMaintenance(...args),
  linkAssetToTicket: (...args: unknown[]) => mockLink(...args),
  createTicketFromAsset: (...args: unknown[]) => mockCreate(...args),
}));

const mockListTickets = vi.fn();
const mockGetStatuses = vi.fn();
vi.mock("../api/tickets", () => ({
  listTickets: (...args: unknown[]) => mockListTickets(...args),
  getTicketStatuses: (...args: unknown[]) => mockGetStatuses(...args),
}));

const mockListBoards = vi.fn();
vi.mock("../api/referenceData", () => ({
  listBoards: (...args: unknown[]) => mockListBoards(...args),
}));

const mockListPriorities = vi.fn();
vi.mock("../api/priorities", () => ({
  listPriorities: (...args: unknown[]) => mockListPriorities(...args),
}));

const stableApi = { client: { request: vi.fn() } as never, apiKey: "k" };
vi.mock("../features/inventory/hooks/useInventoryApi", () => ({
  useInventoryApi: () => stableApi,
}));

const mockShowToast = vi.fn();
vi.mock("../ui/toast/ToastProvider", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

// Drive the board/status/priority pickers directly through onSelect instead of the
// real bottom-sheet, so the create-ticket flow is host-testable.
vi.mock("../ui/components/Select", () => ({
  Select: (props: Record<string, unknown>) => React.createElement("MockSelect", props),
}));

import { AssetDetailScreen } from "./AssetDetailScreen";

const pagination = { page: 1, limit: 50, total: 1, totalPages: 1, hasNext: false, hasPrev: false };

const asset = {
  asset_id: "asset-1",
  asset_tag: "TAG-1",
  name: "Dell Latitude",
  serial_number: "SN-9",
  asset_type: "Workstation",
  status: "active",
  client_id: "client-1",
  client_name: "Acme Corp",
  location: "HQ",
  warranty_end_date: "2030-01-01T00:00:00Z",
  warranty_status: "active",
  purchase_date: "2024-01-01",
};

const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

const maintenance = {
  schedule_id: "sch-1",
  schedule_name: "Quarterly cleanup",
  maintenance_type: "Preventive",
  frequency: "Quarterly",
  next_maintenance: inThreeDays,
  description: "Blow out dust",
};

const history = {
  history_id: "his-1",
  maintenance_type: "Repair",
  description: "Replaced SSD",
  performed_at: "2025-06-01",
  performed_by_user_name: "Jane Tech",
};

const linkedTicket = {
  ticket_id: "lt-1",
  ticket_number: "TKT-001",
  title: "Won't boot",
  status_name: "Open",
  relationship_type: "affected",
};

function ok<T>(data: T) {
  return { ok: true as const, status: 200, data };
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <AssetDetailScreen
        route={{ key: "r", name: "AssetDetail", params: { assetId: "asset-1", assetName: "Device" } } as never}
        navigation={{ navigate: vi.fn() } as never}
      />,
    );
  });
  return tree;
}

const hosts = (tree: ReactTestRenderer, testID: string): ReactTestInstance[] =>
  tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === testID);

const byLabel = (tree: ReactTestRenderer, label: string): ReactTestInstance[] =>
  tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === label);

const mockSelect = (tree: ReactTestRenderer, title: string): ReactTestInstance =>
  tree.root.findAll((node) => String(node.type) === "MockSelect" && node.props.title === title)[0];

function allText(tree: ReactTestRenderer): string {
  const out: string[] = [];
  for (const node of tree.root.findAll((n) => typeof n.type === "string")) {
    const children = node.props.children;
    const push = (value: unknown) => {
      if (typeof value === "string") out.push(value);
    };
    if (Array.isArray(children)) children.forEach(push);
    else push(children);
  }
  return out.join(" | ");
}

describe("AssetDetailScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAsset.mockResolvedValue(ok({ data: asset }));
    mockGetMaintenance.mockResolvedValue(ok({ data: [maintenance] }));
    mockGetHistory.mockResolvedValue(ok({ data: [history] }));
    mockGetTickets.mockResolvedValue(ok({ data: [linkedTicket] }));
    mockGetSoftware.mockResolvedValue(ok({ data: [] }));
    mockRecordMaintenance.mockResolvedValue(ok({ data: {} }));
    mockLink.mockResolvedValue(ok({ data: {} }));
    mockCreate.mockResolvedValue(ok({ data: { ticket_id: "t-100", ticket_number: "TK-100" } }));
    mockListTickets.mockResolvedValue(
      ok({
        data: [{ ticket_id: "tkt-1", ticket_number: "TKT-500", title: "Printer jam", status_name: "Open", client_name: "Acme Corp" }],
        pagination,
      }),
    );
    mockGetStatuses.mockResolvedValue(ok({ data: [{ status_id: "status-1", board_id: "board-1", name: "New", is_closed: false }] }));
    mockListBoards.mockResolvedValue(ok({ data: [{ board_id: "board-1", board_name: "Helpdesk" }], pagination }));
    mockListPriorities.mockResolvedValue(ok({ data: [{ priority_id: "prio-1", priority_name: "High" }], pagination }));
  });

  it("renders identity from the asset fixture", async () => {
    const tree = await renderScreen();
    const text = allText(tree);
    expect(text).toContain("Dell Latitude");
    expect(text).toContain("Acme Corp");
    // Warranty badge maps active -> "Under warranty".
    expect(byLabel(tree, "Under warranty").length).toBeGreaterThan(0);
  });

  it("renders maintenance, history and linked tickets from fixtures", async () => {
    const tree = await renderScreen();
    const text = allText(tree);
    expect(text).toContain("Quarterly cleanup");
    expect(text).toContain("Replaced SSD");
    expect(text).toContain("Won't boot");
    expect(hosts(tree, "asset-detail-ticket-lt-1").length).toBe(1);
    expect(hosts(tree, "asset-detail-maintenance-sch-1").length).toBe(1);
    expect(hosts(tree, "asset-detail-history-his-1").length).toBe(1);
  });

  it("shows empty states when sections are empty", async () => {
    mockGetMaintenance.mockResolvedValue(ok({ data: [] }));
    mockGetHistory.mockResolvedValue(ok({ data: [] }));
    mockGetTickets.mockResolvedValue(ok({ data: [] }));
    const tree = await renderScreen();
    const text = allText(tree);
    expect(text).toContain("No tickets linked to this device yet.");
    expect(text).toContain("No maintenance scheduled.");
    expect(text).toContain("No service history yet.");
  });

  it("still renders when the maintenance fetch fails", async () => {
    mockGetMaintenance.mockResolvedValue({ ok: false, status: 500, error: { kind: "server", message: "boom", status: 500 } });
    const tree = await renderScreen();
    const text = allText(tree);
    // Screen degrades the maintenance section but keeps the rest.
    expect(text).toContain("Dell Latitude");
    expect(text).toContain("No maintenance scheduled.");
  });

  it("links an existing ticket to the asset", async () => {
    const tree = await renderScreen();

    await act(async () => byLabel(tree, "asset-detail-link-ticket")[0].props.onPress());
    await act(async () => {});

    const row = hosts(tree, "asset-detail-link-ticket-option-tkt-1")[0];
    expect(row).toBeTruthy();
    await act(async () => row.props.onPress());

    expect(mockLink).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ticketId: "tkt-1", assetId: "asset-1" }),
    );
  });

  it("creates a ticket from the asset once title and pickers are set", async () => {
    const tree = await renderScreen();

    await act(async () => byLabel(tree, "asset-detail-create-ticket")[0].props.onPress());
    await act(async () => {});

    // Blocked before any input.
    expect(byLabel(tree, "asset-detail-create-ticket-submit")[0].props.disabled).toBe(true);

    act(() => byLabel(tree, "asset-detail-create-ticket-title")[0].props.onChangeText("Broken screen"));
    await act(async () => mockSelect(tree, "Board").props.onSelect("board-1"));
    act(() => mockSelect(tree, "Status").props.onSelect("status-1"));
    act(() => mockSelect(tree, "Priority").props.onSelect("prio-1"));

    const submit = byLabel(tree, "asset-detail-create-ticket-submit")[0];
    expect(submit.props.disabled).toBe(false);
    await act(async () => submit.props.onPress());

    expect(mockCreate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Broken screen",
          board_id: "board-1",
          status_id: "status-1",
          priority_id: "prio-1",
          asset_id: "asset-1",
          client_id: "client-1",
        }),
      }),
    );
  });

  it("renders installed software when the RMM reports it", async () => {
    mockGetSoftware.mockResolvedValue(
      ok({ data: [{ software_id: "sw-1", name: "Google Chrome", version: "120.0", publisher: "Google LLC" }] }),
    );
    const tree = await renderScreen();
    const text = allText(tree);
    expect(text).toContain("Google Chrome");
    expect(text).toContain("Google LLC");
    expect(hosts(tree, "asset-detail-software-sw-1").length).toBe(1);
  });

  it("records a scheduled maintenance task as done", async () => {
    const tree = await renderScreen();

    await act(async () => hosts(tree, "asset-detail-maintenance-done-sch-1")[0].props.onPress());
    await act(async () => {});

    act(() => byLabel(tree, "asset-detail-maintenance-note")[0].props.onChangeText("Blew out dust"));
    await act(async () => byLabel(tree, "asset-detail-maintenance-record-submit")[0].props.onPress());

    expect(mockRecordMaintenance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        assetId: "asset-1",
        data: expect.objectContaining({ schedule_id: "sch-1", description: "Blew out dust" }),
      }),
    );
    // Records refetch maintenance + history after a successful write.
    expect(mockGetMaintenance).toHaveBeenCalledTimes(2);
  });
});
