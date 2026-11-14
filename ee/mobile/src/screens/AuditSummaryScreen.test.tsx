import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  getAssetAudit: vi.fn(),
  navigate: vi.fn(),
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
vi.mock("../api/assetAudits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/assetAudits")>()),
  getAssetAudit: (...args: unknown[]) => mocks.getAssetAudit(...args),
}));
vi.mock("../logging/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { AuditSummaryScreen } from "./AuditSummaryScreen";

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
      React.createElement(AuditSummaryScreen, {
        navigation: { navigate: mocks.navigate },
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

describe("AuditSummaryScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAssetAudit.mockResolvedValue({
      ok: true,
      data: {
        data: {
          audit_id: "au-1",
          client_id: "cl-1",
          location_id: "loc-1",
          status: "completed",
          started_by: "user-1",
          started_at: "2026-10-16T09:00:00Z",
          completed_at: "2026-10-16T10:00:00Z",
          expected_count: 3,
          present_count: 1,
          missing_count: 1,
          unexpected_count: 1,
          items: [
            { asset_id: "a-1", result: "present", method: "scan", marked_at: null, marked_by: null, asset_name: "Found PC" },
            { asset_id: "a-2", result: "missing", method: null, marked_at: null, marked_by: null, asset_name: "Lost PC", asset_tag: "T-2" },
            {
              asset_id: "a-3",
              result: "unexpected",
              method: "scan",
              marked_at: null,
              marked_by: null,
              asset_name: "Stray PC",
              location: "Warehouse",
            },
          ],
        },
      },
    });
  });

  it("T071 lists the missing rows with Create ticket preselecting the asset", async () => {
    const renderer = await renderScreen();

    expect(texts(renderer)).toContain("Lost PC");
    await act(async () =>
      renderer.root.find((n) => n.props?.testID === "audit-summary-create-ticket-a-2").props.onPress(),
    );

    // One create form for every route in: the missing device seeds its picker.
    expect(mocks.navigate).toHaveBeenCalledWith("CreateTicket", {
      clientId: "cl-1",
      clientName: undefined,
      assets: [{ asset_id: "a-2", name: "Lost PC" }],
    });
  });

  it("shows the three counts and the unexpected device's real location", async () => {
    const renderer = await renderScreen();
    const all = texts(renderer);

    expect(all).toContain("1");
    expect(all).toContain("Present");
    expect(all).toContain("Missing");
    expect(all).toContain("Stray PC");
    expect(all).toContain("Warehouse");
  });

  it("Done returns to the Assets tab", async () => {
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "audit-summary-done").props.onPress());

    expect(mocks.navigate).toHaveBeenCalledWith("Tabs", { screen: "AssetsTab" });
  });

  it("opens the asset from a missing row", async () => {
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "audit-summary-open-a-2").props.onPress());

    expect(mocks.navigate).toHaveBeenCalledWith("AssetDetail", { assetId: "a-2", assetName: "Lost PC" });
  });
});
