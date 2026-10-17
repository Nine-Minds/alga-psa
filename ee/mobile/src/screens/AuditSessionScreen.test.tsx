import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  getAssetAudit: vi.fn(),
  markAssetAuditItem: vi.fn(),
  unmarkAssetAuditItem: vi.fn(),
  completeAssetAudit: vi.fn(),
  cancelAssetAudit: vi.fn(),
  lookupInventoryCode: vi.fn(),
  showToast: vi.fn(),
  replace: vi.fn(),
  goBack: vi.fn(),
  alert: vi.fn(),
  offline: false,
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
  return {
    ...actual,
    Alert: { alert: (...args: unknown[]) => mocks.alert(...args) },
    Vibration: { vibrate: vi.fn() },
  };
});
vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mocks.authValue }));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => ({ ok: true, env: "dev", baseUrl: "https://algapsa.com" }) }));
vi.mock("../api", () => ({ createApiClient: () => ({ request: vi.fn() }) }));
vi.mock("../api/assetAudits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/assetAudits")>()),
  getAssetAudit: (...args: unknown[]) => mocks.getAssetAudit(...args),
  markAssetAuditItem: (...args: unknown[]) => mocks.markAssetAuditItem(...args),
  unmarkAssetAuditItem: (...args: unknown[]) => mocks.unmarkAssetAuditItem(...args),
  completeAssetAudit: (...args: unknown[]) => mocks.completeAssetAudit(...args),
  cancelAssetAudit: (...args: unknown[]) => mocks.cancelAssetAudit(...args),
}));
vi.mock("../api/inventory", () => ({ lookupInventoryCode: (...args: unknown[]) => mocks.lookupInventoryCode(...args) }));
vi.mock("../features/assets/audit/AuditScanner", () => ({
  AuditScanner: (props: Record<string, unknown>) => React.createElement("MockAuditScanner", props),
}));
vi.mock("../features/inventory/components/RegisterAssetModal", () => ({
  RegisterAssetModal: (props: Record<string, unknown>) => React.createElement("MockRegisterAsset", props),
}));
vi.mock("../ui/toast/ToastProvider", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../network/useNetworkStatus", () => ({
  useNetworkStatus: () =>
    mocks.offline ? { isConnected: false, isInternetReachable: false } : { isConnected: true, isInternetReachable: true },
}));
vi.mock("../logging/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { AuditSessionScreen } from "./AuditSessionScreen";

function auditWith(items: unknown[], status = "in_progress") {
  return {
    ok: true,
    data: {
      data: {
        audit_id: "au-1",
        client_id: "cl-1",
        client_name: "Emerald City",
        location_id: "loc-1",
        location_name: "Main office",
        status,
        started_by: "user-1",
        started_at: "2026-10-16T09:00:00Z",
        completed_at: null,
        expected_count: 2,
        present_count: 0,
        missing_count: 0,
        unexpected_count: 0,
        items,
      },
    },
  };
}

const EXPECTED_ITEMS = [
  { asset_id: "a-1", result: "expected", method: null, marked_at: null, marked_by: null, asset_name: "Reception PC", asset_tag: "T-1" },
  { asset_id: "a-2", result: "expected", method: null, marked_at: null, marked_by: null, asset_name: "Back office PC", asset_tag: "T-2", serial_number: "SN-7" },
];

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
    renderer = create(
      React.createElement(AuditSessionScreen, {
        navigation: { replace: mocks.replace, goBack: mocks.goBack, navigate: vi.fn() },
        route: { params: { auditId: "au-1" } },
      } as never),
    );
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

/** Host nodes only: a View with a testID yields both a composite and a host. */
function hostsWithTestId(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findAll((node) => typeof node.type === "string" && node.props?.testID === testID);
}

function scanner(renderer: ReactTestRenderer) {
  return renderer.root.find((n) => n.type === ("MockAuditScanner" as never));
}

describe("AuditSessionScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.offline = false;
    mocks.getAssetAudit.mockResolvedValue(auditWith(EXPECTED_ITEMS));
    mocks.markAssetAuditItem.mockImplementation(async (_client: unknown, params: Record<string, string>) =>
      auditWith(
        EXPECTED_ITEMS.map((item) =>
          item.asset_id === params.assetId
            ? { ...item, result: params.result === "unexpected" ? "unexpected" : "present", method: params.method }
            : item,
        ),
      ),
    );
    mocks.unmarkAssetAuditItem.mockResolvedValue(auditWith(EXPECTED_ITEMS));
    mocks.completeAssetAudit.mockResolvedValue(auditWith(EXPECTED_ITEMS, "completed"));
    mocks.cancelAssetAudit.mockResolvedValue(auditWith(EXPECTED_ITEMS, "cancelled"));
  });

  it("T061 shows the expected items under Remaining with Present empty", async () => {
    const renderer = await renderScreen();

    expect(texts(renderer)).toContain("0 of 2 present");
    expect(texts(renderer)).toContain("Reception PC");
    expect(hostsWithTestId(renderer, "audit-item-a-1")).toHaveLength(1);

    await act(async () => renderer.root.find((n) => n.props?.testID === "audit-session-segment-present").props.onPress());
    expect(texts(renderer)).toContain("Nothing marked present yet.");
  });

  it("T062 a scan of an expected asset marks it present with method scan", async () => {
    mocks.lookupInventoryCode.mockResolvedValue({
      ok: true,
      data: { data: { type: "asset", asset: { asset_id: "a-1" } } },
    });
    const renderer = await renderScreen();

    await act(async () => scanner(renderer).props.onScan("CODE-1"));
    await flush();

    expect(mocks.markAssetAuditItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assetId: "a-1", method: "scan", result: "present" }),
    );
    expect(texts(renderer)).toContain("1 of 2 present");
  });

  it("T063 a scan of an already-present asset only toasts", async () => {
    mocks.getAssetAudit.mockResolvedValue(
      auditWith([{ ...EXPECTED_ITEMS[0], result: "present" }, EXPECTED_ITEMS[1]]),
    );
    mocks.lookupInventoryCode.mockResolvedValue({
      ok: true,
      data: { data: { type: "asset", asset: { asset_id: "a-1" } } },
    });
    const renderer = await renderScreen();

    await act(async () => scanner(renderer).props.onScan("CODE-1"));
    await flush();

    expect(mocks.markAssetAuditItem).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith({ message: "Already marked present", tone: "info" });
  });

  it("T064 a scan of an out-of-scope asset is recorded as unexpected", async () => {
    mocks.lookupInventoryCode.mockResolvedValue({
      ok: true,
      data: { data: { type: "asset", asset: { asset_id: "a-9" } } },
    });
    const renderer = await renderScreen();

    await act(async () => scanner(renderer).props.onScan("CODE-9"));
    await flush();

    expect(mocks.markAssetAuditItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assetId: "a-9", result: "unexpected" }),
    );
  });

  it("T119 a second scan of an unexpected asset only toasts, so it cannot be promoted", async () => {
    mocks.getAssetAudit.mockResolvedValue(
      auditWith([
        ...EXPECTED_ITEMS,
        { asset_id: "a-9", result: "unexpected", asset_name: "Stray", asset_tag: "A-9" },
      ]),
    );
    mocks.lookupInventoryCode.mockResolvedValue({
      ok: true,
      data: { data: { type: "asset", asset: { asset_id: "a-9" } } },
    });
    const renderer = await renderScreen();

    await act(async () => scanner(renderer).props.onScan("CODE-9"));
    await flush();

    expect(mocks.markAssetAuditItem).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith({
      message: "Already recorded as unexpected",
      tone: "info",
    });
  });

  it("T065 an unknown code offers Register asset in scope and marks it present", async () => {
    mocks.lookupInventoryCode.mockResolvedValue({ ok: true, data: { data: { type: "none", candidates: [] } } });
    const renderer = await renderScreen();

    await act(async () => scanner(renderer).props.onScan("NEW-CODE"));
    await flush();

    const register = renderer.root.find((n) => n.type === ("MockRegisterAsset" as never));
    expect(register.props.code).toBe("NEW-CODE");
    // The audit's scope is prefilled: the tech never re-picks the client, and
    // the device is created at the location being audited.
    expect(register.props).toMatchObject({
      clientId: "cl-1",
      clientName: "Emerald City",
      locationId: "loc-1",
      locationName: "Main office",
    });

    await act(async () => register.props.onCreated("a-new", "New PC"));
    await flush();

    expect(mocks.markAssetAuditItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assetId: "a-new", method: "register", result: "present" }),
    );
  });

  it("a scan that is not an asset toasts and marks nothing", async () => {
    mocks.lookupInventoryCode.mockResolvedValue({
      ok: true,
      data: { data: { type: "product", product: {}, levels: [] } },
    });
    const renderer = await renderScreen();

    await act(async () => scanner(renderer).props.onScan("PRODUCT"));
    await flush();

    expect(mocks.markAssetAuditItem).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith({ message: "That code is not a device.", tone: "error" });
  });

  it("T066 Mark present uses method manual and Unmark calls the unmark route", async () => {
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "audit-item-action-a-1").props.onPress());
    await flush();
    expect(mocks.markAssetAuditItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assetId: "a-1", method: "manual" }),
    );

    await act(async () => renderer.root.find((n) => n.props?.testID === "audit-session-segment-present").props.onPress());
    await act(async () => renderer.root.find((n) => n.props?.testID === "audit-item-action-a-1").props.onPress());
    await flush();
    expect(mocks.unmarkAssetAuditItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assetId: "a-1" }),
    );
  });

  it("T067 the search field filters Remaining by tag and serial", async () => {
    const renderer = await renderScreen();

    await act(async () =>
      renderer.root
        .find((n) => n.props?.accessibilityLabel === "Search by name, tag or serial" && n.props?.onChangeText)
        .props.onChangeText("SN-7"),
    );

    expect(hostsWithTestId(renderer, "audit-item-a-2")).toHaveLength(1);
    expect(hostsWithTestId(renderer, "audit-item-a-1")).toHaveLength(0);
  });

  it("T068 Finish with remaining items confirms before completing", async () => {
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "audit-session-finish").props.onPress());

    expect(mocks.alert).toHaveBeenCalled();
    const [, body, buttons] = mocks.alert.mock.calls[0] as [string, string, Array<{ onPress?: () => void }>];
    expect(body).toContain("2");
    expect(mocks.completeAssetAudit).not.toHaveBeenCalled();

    await act(async () => buttons[1].onPress?.());
    await flush();

    expect(mocks.completeAssetAudit).toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith("AuditSummary", { auditId: "au-1" });
  });

  it("T069 Finish with nothing remaining completes without a confirmation", async () => {
    mocks.getAssetAudit.mockResolvedValue(
      auditWith(EXPECTED_ITEMS.map((item) => ({ ...item, result: "present" }))),
    );
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "audit-session-finish").props.onPress());
    await flush();

    expect(mocks.alert).not.toHaveBeenCalled();
    expect(mocks.completeAssetAudit).toHaveBeenCalled();
  });

  it("T070 an audit found completed on mount redirects to the summary", async () => {
    mocks.getAssetAudit.mockResolvedValue(auditWith(EXPECTED_ITEMS, "completed"));

    await renderScreen();

    expect(mocks.replace).toHaveBeenCalledWith("AuditSummary", { auditId: "au-1" });
  });

  it("T073 offline: a scan and a manual mark toast and change nothing", async () => {
    mocks.offline = true;
    const renderer = await renderScreen();

    await act(async () => scanner(renderer).props.onScan("CODE-1"));
    await act(async () => renderer.root.find((n) => n.props?.testID === "audit-item-action-a-1").props.onPress());
    await flush();

    expect(mocks.lookupInventoryCode).not.toHaveBeenCalled();
    expect(mocks.markAssetAuditItem).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith({
      message: "You are offline; marks need a connection.",
      tone: "error",
    });
    expect(texts(renderer)).toContain("0 of 2 present");
  });

  it("cancels the audit after confirmation", async () => {
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "audit-session-cancel").props.onPress());
    const buttons = (mocks.alert.mock.calls[0] as [string, string, Array<{ onPress?: () => void }>])[2];
    await act(async () => buttons[1].onPress?.());
    await flush();

    expect(mocks.cancelAssetAudit).toHaveBeenCalled();
    expect(mocks.goBack).toHaveBeenCalled();
  });
});
