import React from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const getMyCapabilities = vi.hoisted(() => vi.fn());

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

vi.mock("../api", () => ({ createApiClient: () => ({ request: vi.fn() }) }));

vi.mock("../api/capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/capabilities")>()),
  getMyCapabilities,
}));

// Stable identity, like the real AuthContext value: a fresh object on every
// render would re-create `refresh` and loop the effect.
const authValue = vi.hoisted(() => ({
  session: { accessToken: "token-1", tenantId: "tenant-1" },
  refreshSession: () => Promise.resolve(null),
  baseUrl: "https://alga.example.com",
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: () => authValue }));

vi.mock("../hooks/useAppResume", () => ({ useAppResume: () => {} }));

vi.mock("../ui/TenantThemeBridge", () => ({ TenantThemeBridge: () => null }));

import { CapabilitiesProvider, useCapabilities } from "./CapabilitiesContext";
import { ALGA_THEME_TOKENS } from "../ui/themes";
import { logger } from "../logging/logger";

const themeBlock = {
  pairId: "forest",
  label: "Forest",
  light: ALGA_THEME_TOKENS.light,
  dark: ALGA_THEME_TOKENS.dark,
  version: "forest-v1",
};

let value: ReturnType<typeof useCapabilities>;

function Probe() {
  value = useCapabilities();
  return null;
}

async function renderProvider() {
  await act(async () => {
    create(
      <CapabilitiesProvider>
        <Probe />
      </CapabilitiesProvider>,
    );
  });
}

describe("CapabilitiesProvider", () => {
  beforeEach(() => {
    getMyCapabilities.mockReset();
  });

  it("T031 exposes the theme block from the response", async () => {
    getMyCapabilities.mockResolvedValue({
      ok: true,
      data: { data: { features: { inventory: true, opportunities: false, opportunitiesCreate: false }, theme: themeBlock } },
    });

    await renderProvider();

    expect(value.features.inventory).toBe(true);
    expect(value.theme?.pairId).toBe("forest");
    expect(value.theme?.version).toBe("forest-v1");
  });

  it("logs the pair it applied so a theme mismatch is visible in Metro", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    getMyCapabilities.mockResolvedValue({
      ok: true,
      data: { data: { features: { inventory: false, opportunities: false, opportunitiesCreate: false }, theme: themeBlock } },
    });

    await renderProvider();

    expect(info).toHaveBeenCalledWith("capabilities.theme", { pairId: "forest", version: "forest-v1" });
    info.mockRestore();
  });

  it("warns when the server sends a theme block the app cannot parse", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    getMyCapabilities.mockResolvedValue({
      ok: true,
      data: { data: { features: { inventory: false, opportunities: false, opportunitiesCreate: false }, theme: { pairId: "forest", light: {} } } },
    });

    await renderProvider();

    expect(warn).toHaveBeenCalledWith("capabilities.theme_rejected", { pairId: "forest" });
    expect(value.theme).toBeNull();
    warn.mockRestore();
  });

  it("T031 exposes null for a server that sends no theme", async () => {
    getMyCapabilities.mockResolvedValue({
      ok: true,
      data: { data: { features: { inventory: false, opportunities: false, opportunitiesCreate: false } } },
    });

    await renderProvider();

    expect(value.theme).toBeNull();
  });

  it("T031 exposes null when the theme block is malformed", async () => {
    getMyCapabilities.mockResolvedValue({
      ok: true,
      data: { data: { features: {}, theme: { pairId: "forest", version: "v1", light: {}, dark: {} } } },
    });

    await renderProvider();

    expect(value.theme).toBeNull();
  });

  it("T031 keeps the endpoint failure path working", async () => {
    getMyCapabilities.mockResolvedValue({ ok: false, error: { kind: "http" } });

    await renderProvider();

    expect(value.features).toEqual({ inventory: false, opportunities: false, opportunitiesCreate: false });
    expect(value.theme).toBeNull();
    expect(value.loaded).toBe(true);
  });
});
