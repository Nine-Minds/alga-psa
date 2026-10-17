import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  listAssetStatuses: vi.fn(),
  listAssets: vi.fn(),
  listClients: vi.fn(),
  listClientLocations: vi.fn(),
  startAssetAudit: vi.fn(),
  replace: vi.fn(),
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
vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mocks.authValue }));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => ({ ok: true, env: "dev", baseUrl: "https://algapsa.com" }) }));
vi.mock("../api", () => ({ createApiClient: () => ({ request: vi.fn() }) }));
vi.mock("../api/assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/assets")>()),
  listAssetStatuses: (...args: unknown[]) => mocks.listAssetStatuses(...args),
  listAssets: (...args: unknown[]) => mocks.listAssets(...args),
}));
vi.mock("../api/assetAudits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/assetAudits")>()),
  startAssetAudit: (...args: unknown[]) => mocks.startAssetAudit(...args),
}));
vi.mock("../api/clients", () => ({ listClients: (...args: unknown[]) => mocks.listClients(...args) }));
vi.mock("../api/referenceData", () => ({
  listClientLocations: (...args: unknown[]) => mocks.listClientLocations(...args),
}));
vi.mock("../logging/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { AuditSetupScreen, defaultAuditStatuses, NO_LOCATION_ID } from "./AuditSetupScreen";

const STATUSES = [
  { slug: "active", label: "Active", kind: "deployable" as const },
  { slug: "in_stock", label: "In stock", kind: "deployable" as const },
  { slug: "maintenance", label: "Maintenance", kind: "pending" as const },
  { slug: "inactive", label: "Inactive", kind: "undeployable" as const },
  { slug: "retired", label: "Retired", kind: "archived" as const },
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
      React.createElement(AuditSetupScreen, {
        navigation: { replace: mocks.replace, navigate: vi.fn() },
        route: { params: undefined },
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

async function pickClient(renderer: ReactTestRenderer) {
  await act(async () => renderer.root.find((n) => n.props?.testID === "audit-setup-client").props.onPress());
  await flush();
  const picker = renderer.root.findAll((n) => n.props?.onSelect && n.props?.title === "Select a client")[0];
  await act(async () => picker.props.onSelect("cl-1", "ECTS"));
  await flush();
}

describe("AuditSetupScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAssetStatuses.mockResolvedValue({ ok: true, data: { data: STATUSES } });
    mocks.listClients.mockResolvedValue({ ok: true, data: { data: [{ client_id: "cl-1", client_name: "ECTS" }] } });
    mocks.listClientLocations.mockResolvedValue({
      ok: true,
      data: { data: [{ location_id: "loc-1", location_name: "HQ" }] },
    });
    mocks.listAssets.mockResolvedValue({ ok: true, data: { data: [], pagination: { page: 1, limit: 1, total: 16 } } });
    mocks.startAssetAudit.mockResolvedValue({ ok: true, data: { data: { audit_id: "au-1" } } });
  });

  it("T060 defaults the status chips to the deployable and pending kinds", () => {
    expect(defaultAuditStatuses(STATUSES)).toEqual(["active", "in_stock", "maintenance"]);
  });

  it("T059 enables Start only with a client and shows the expected count", async () => {
    const renderer = await renderScreen();

    expect(renderer.root.find((n) => n.props?.testID === "audit-setup-start").props.disabled).toBe(true);

    await pickClient(renderer);

    expect(renderer.root.find((n) => n.props?.testID === "audit-setup-start").props.disabled).toBe(false);
    expect(texts(renderer)).toContain("16 devices expected");
  });

  it("the location row stays disabled until a client is chosen", async () => {
    const renderer = await renderScreen();
    expect(renderer.root.find((n) => n.props?.testID === "audit-setup-location").props.disabled).toBe(true);

    await pickClient(renderer);
    expect(renderer.root.find((n) => n.props?.testID === "audit-setup-location").props.disabled).toBe(false);
  });

  it("starts the audit with the chosen scope and replaces the route with the session", async () => {
    const renderer = await renderScreen();
    await pickClient(renderer);

    await act(async () => renderer.root.find((n) => n.props?.testID === "audit-setup-location").props.onPress());
    await flush();
    const locationPicker = renderer.root.findAll((n) => n.props?.onSelect && n.props?.title === "Select a location")[0];
    await act(async () => locationPicker.props.onSelect("loc-1", "HQ"));

    await act(async () => renderer.root.find((n) => n.props?.testID === "audit-setup-start").props.onPress());
    await flush();

    expect(mocks.startAssetAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: { client_id: "cl-1", location_id: "loc-1", statuses: ["active", "in_stock", "maintenance"] },
      }),
    );
    expect(mocks.replace).toHaveBeenCalledWith("AuditSession", { auditId: "au-1" });
  });

  it("sends location_id null for the No location choice", async () => {
    const renderer = await renderScreen();
    await pickClient(renderer);

    await act(async () => renderer.root.find((n) => n.props?.testID === "audit-setup-location").props.onPress());
    await flush();
    const locationPicker = renderer.root.findAll((n) => n.props?.onSelect && n.props?.title === "Select a location")[0];
    expect(locationPicker.props.items[0].id).toBe(NO_LOCATION_ID);
    await act(async () => locationPicker.props.onSelect(NO_LOCATION_ID, "No location"));

    await act(async () => renderer.root.find((n) => n.props?.testID === "audit-setup-start").props.onPress());
    await flush();

    expect(mocks.startAssetAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ data: expect.objectContaining({ location_id: null }) }),
    );
  });

  it("surfaces a failed start without navigating", async () => {
    mocks.startAssetAudit.mockResolvedValue({ ok: false, error: { kind: "server", message: "boom", status: 500 } });
    const renderer = await renderScreen();
    await pickClient(renderer);

    await act(async () => renderer.root.find((n) => n.props?.testID === "audit-setup-start").props.onPress());
    await flush();

    expect(renderer.root.find((n) => n.props?.testID === "audit-setup-error")).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
