import React from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const writeCachedTheme = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const setTenantTheme = vi.hoisted(() => vi.fn());

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

vi.mock("./themeCache", () => ({ writeCachedTheme }));

vi.mock("./ThemeContext", () => ({
  useTenantTheme: () => ({ setTenantTheme, tenantTheme: null, pairId: "alga", label: null }),
}));

import { TenantThemeBridge } from "./TenantThemeBridge";
import { ALGA_THEME_TOKENS } from "./themes";
import type { MobileTheme } from "./themeTokens";

const theme = (version: string): MobileTheme => ({
  pairId: "forest",
  label: "Forest",
  light: ALGA_THEME_TOKENS.light,
  dark: ALGA_THEME_TOKENS.dark,
  version,
});

const BASE_URL = "https://alga.example.com";

function render(props: { theme: MobileTheme | null; baseUrl?: string | null; tenantId?: string | null }) {
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(
      <TenantThemeBridge
        theme={props.theme}
        baseUrl={props.baseUrl ?? BASE_URL}
        tenantId={props.tenantId ?? "tenant-1"}
      />,
    );
  });
  return renderer!;
}

describe("TenantThemeBridge", () => {
  beforeEach(() => {
    writeCachedTheme.mockClear();
    setTenantTheme.mockClear();
  });

  it("T027 pushes the theme into ThemeContext and caches it", () => {
    render({ theme: theme("v1") });

    expect(setTenantTheme).toHaveBeenCalledWith(expect.objectContaining({ version: "v1" }));
    expect(writeCachedTheme).toHaveBeenCalledWith(BASE_URL, "tenant-1", expect.objectContaining({ version: "v1" }));
  });

  it("T035 writes the cache again only when the version changes", () => {
    const renderer = render({ theme: theme("v1") });
    expect(writeCachedTheme).toHaveBeenCalledTimes(1);

    // A capabilities refresh hands back an equal-but-new object.
    act(() => {
      renderer.update(
        <TenantThemeBridge theme={theme("v1")} baseUrl={BASE_URL} tenantId="tenant-1" />,
      );
    });
    expect(writeCachedTheme).toHaveBeenCalledTimes(1);

    act(() => {
      renderer.update(
        <TenantThemeBridge theme={theme("v2")} baseUrl={BASE_URL} tenantId="tenant-1" />,
      );
    });
    expect(writeCachedTheme).toHaveBeenCalledTimes(2);
    expect(setTenantTheme).toHaveBeenLastCalledWith(expect.objectContaining({ version: "v2" }));
  });

  it("T038 pushes null without caching when the session ends", () => {
    render({ theme: null });

    expect(setTenantTheme).toHaveBeenCalledWith(null);
    expect(writeCachedTheme).not.toHaveBeenCalled();
  });
});
