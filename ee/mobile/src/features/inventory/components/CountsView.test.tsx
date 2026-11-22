import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.fn();
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

const mockListSessions = vi.fn();
const mockListLocations = vi.fn();
const mockStart = vi.fn();
vi.mock("../../../api/inventory", () => ({
  listCountSessions: (...args: unknown[]) => mockListSessions(...args),
  listStockLocations: (...args: unknown[]) => mockListLocations(...args),
  startCountSession: (...args: unknown[]) => mockStart(...args),
}));

const api = { current: { client: { request: vi.fn() } as never, apiKey: "key-1" as string | null } };
vi.mock("../hooks/useInventoryApi", () => ({ useInventoryApi: () => api.current }));

const mockShowToast = vi.fn();
vi.mock("../../../ui/toast/ToastProvider", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

import { Select } from "../../../ui/components";
import { CountsView } from "./CountsView";

const text = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((n) => String(n.type) === "Text")
    .map((n) => [].concat(n.props.children ?? []).join(""))
    .join("\n");
const byLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => typeof String(n.type) === "string" && n.props.accessibilityLabel === label);

const SESSIONS = [
  { session_id: "cs-1", location_id: "loc-1", location_name: "Main", status: "in_progress", created_at: "2026-11-01T10:00:00Z" },
  { session_id: "cs-2", location_id: "loc-2", status: "review" },
  { session_id: "cs-3", location_id: "loc-3", location_name: "Van", status: "approved" },
  { session_id: "cs-4", location_id: "loc-4", location_name: "Shelf", status: "cancelled" },
];

async function render() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<CountsView />);
  });
  return tree;
}

async function pickLocation(tree: ReactTestRenderer, id: string) {
  act(() => tree.root.find((n) => String(n.type) === "Pressable" && n.props.testID === "inventory-counts-location").props.onPress());
  expect(tree.root.findByType(Select).props.visible).toBe(true);
  act(() => tree.root.findByType(Select).props.onSelect(id));
}

const startButton = (tree: ReactTestRenderer) => byLabel(tree, "inventory-counts-start")[0];

describe("CountsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.current = { client: { request: vi.fn() } as never, apiKey: "key-1" };
    mockListSessions.mockResolvedValue({ ok: true, data: { data: SESSIONS } });
    mockListLocations.mockResolvedValue({
      ok: true,
      data: { data: [{ location_id: "loc-1", name: "Main" }, { location_id: "loc-2", name: "Van 1" }] },
    });
  });

  it("lists sessions with location fallback and date", async () => {
    const tree = await render();
    const all = text(tree);
    expect(all).toContain("Main");
    expect(all).toContain("2026-11-01");
    expect(all).toContain("loc-2");
    expect(all).toContain("in_progress");
    expect(all).toContain("cancelled");
  });

  it("opens a session on row press", async () => {
    const tree = await render();
    act(() => byLabel(tree, "inventory-count-row-cs-1")[0].props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith("CountSession", { sessionId: "cs-1", locationName: "Main" });
  });

  it("disables start until a location is picked, then starts and navigates", async () => {
    mockStart.mockResolvedValue({ ok: true, data: { data: { session_id: "cs-new", location_name: "Van 1" } } });
    const tree = await render();
    expect(startButton(tree).props.disabled).toBe(true);
    await pickLocation(tree, "loc-2");
    expect(text(tree)).toContain("Van 1");
    expect(startButton(tree).props.disabled).toBe(false);
    await act(async () => startButton(tree).props.onPress());
    expect(mockStart).toHaveBeenCalledWith(api.current.client, { apiKey: "key-1", data: { location_id: "loc-2" } });
    expect(mockNavigate).toHaveBeenCalledWith("CountSession", { sessionId: "cs-new", locationName: "Van 1" });
    expect(mockListSessions).toHaveBeenCalledTimes(2);
  });

  it("resumes the open session for the location on a 409 conflict", async () => {
    mockStart.mockResolvedValue({ ok: false, error: { kind: "http", status: 409, message: "exists" } });
    const tree = await render();
    await pickLocation(tree, "loc-1");
    await act(async () => startButton(tree).props.onPress());
    expect(mockListSessions).toHaveBeenLastCalledWith(api.current.client, { apiKey: "key-1", page: 1, limit: 50 });
    expect(mockShowToast).toHaveBeenCalledWith({ tone: "info", message: "Resuming the open count for this location" });
    expect(mockNavigate).toHaveBeenCalledWith("CountSession", { sessionId: "cs-1", locationName: "Main" });
  });

  it("shows the server error when a 409 has no open session to resume", async () => {
    mockStart.mockResolvedValue({ ok: false, error: { kind: "http", status: 409, message: "Conflict" } });
    const tree = await render();
    await pickLocation(tree, "loc-2");
    await act(async () => startButton(tree).props.onPress());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith({ tone: "error", message: "Conflict" });
  });

  it("falls back to a generic error message when start fails without one", async () => {
    mockStart.mockResolvedValue({ ok: false, error: { kind: "network", message: "" } });
    const tree = await render();
    await pickLocation(tree, "loc-1");
    await act(async () => startButton(tree).props.onPress());
    expect(mockShowToast).toHaveBeenCalledWith({ tone: "error", message: "Lookup failed. Try again." });
  });

  it("closing the picker hides it", async () => {
    const tree = await render();
    act(() => tree.root.find((n) => String(n.type) === "Pressable" && n.props.testID === "inventory-counts-location").props.onPress());
    act(() => tree.root.findByType(Select).props.onClose());
    expect(tree.root.findByType(Select).props.visible).toBe(false);
  });

  it("shows empty, no-access, error and retry states", async () => {
    mockListSessions.mockResolvedValueOnce({ ok: true, data: { data: [] } });
    expect(text(await render())).toContain("No count sessions.");
    mockListSessions.mockResolvedValueOnce({ ok: false, error: { kind: "permission" } });
    expect(text(await render())).toContain("You don't have access to inventory.");
    mockListSessions.mockResolvedValueOnce({ ok: false, error: { kind: "server" } });
    const tree = await render();
    await act(async () => tree.root.find((n) => String(n.type) === "Text" && n.props.children === "Retry").props.onPress());
    expect(text(tree)).toContain("Main");
  });

  it("stays loading on cancel; skips fetching without a client", async () => {
    mockListSessions.mockResolvedValueOnce({ ok: false, error: { kind: "canceled" } });
    expect(text(await render())).toContain("Loading...");
    vi.clearAllMocks();
    api.current = { client: null as never, apiKey: null };
    await render();
    expect(mockListSessions).not.toHaveBeenCalled();
    expect(mockListLocations).not.toHaveBeenCalled();
  });

  it("pull to refresh refetches sessions", async () => {
    const tree = await render();
    await act(async () => {
      await tree.root.find((n) => String(n.type) === "FlatList" && n.props.refreshControl).props.refreshControl.props.onRefresh();
    });
    expect(mockListSessions).toHaveBeenCalledTimes(2);
  });
});
