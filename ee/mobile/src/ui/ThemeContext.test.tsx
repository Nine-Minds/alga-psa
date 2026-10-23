import React from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const colorScheme = { value: "light" as "light" | "dark" };

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  useColorScheme: () => colorScheme.value,
}));

const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("expo-secure-store", () => secureStore);

import { ThemeProvider, useTenantTheme, useTheme, useThemePreference } from "./ThemeContext";
import { lightTheme, darkTheme } from "./themes";
import type { MobileTheme, MobileThemeSeedTokens } from "./themeTokens";
import fixtureJson from "./themeMath.fixture.json";

const fixture = fixtureJson as unknown as {
  presets: Record<string, { tokens: Record<"light" | "dark", MobileThemeSeedTokens> }>;
};

const forestTheme = (version = "forest-v1"): MobileTheme => ({
  pairId: "forest",
  label: "Forest",
  light: fixture.presets.forest.tokens.light,
  dark: fixture.presets.forest.tokens.dark,
  version,
});

type Probe = {
  theme: ReturnType<typeof useTheme>;
  pairId: string;
  label: string | null;
  setTenantTheme: (theme: MobileTheme | null) => void;
  setPreference: (pref: "light" | "dark" | "system") => void;
};

let probe: Probe;
const renders: Array<ReturnType<typeof useTheme>> = [];

function ProbeComponent() {
  const theme = useTheme();
  const { pairId, label, setTenantTheme } = useTenantTheme();
  const { setPreference } = useThemePreference();
  probe = { theme, pairId, label, setTenantTheme, setPreference };
  renders.push(theme);
  return null;
}

function renderProvider(initialTenantTheme: MobileTheme | null = null) {
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(
      <ThemeProvider initialTenantTheme={initialTenantTheme}>
        <ProbeComponent />
      </ThemeProvider>,
    );
  });
  return renderer!;
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    colorScheme.value = "light";
    renders.length = 0;
    secureStore.getItemAsync.mockResolvedValue(null);
    secureStore.setItemAsync.mockClear();
  });

  it("T033 renders the built-in Alga pair when no tenant theme is present", () => {
    renderProvider(null);
    expect(probe.theme).toBe(lightTheme);
    expect(probe.pairId).toBe("alga");
    expect(probe.label).toBeNull();
  });

  it("T032 renders the Forest pair supplied by the capabilities bridge", () => {
    renderProvider(null);
    act(() => probe.setTenantTheme(forestTheme()));

    expect(probe.theme.pairId).toBe("forest");
    expect(probe.theme.colors.background).toBe(fixture.presets.forest.tokens.light.background);
    expect(probe.theme.colors.primary).toBe(fixture.presets.forest.tokens.light.primary);
  });

  it("T036 renders the cached pair on mount, before any capabilities response", () => {
    renderProvider(forestTheme());
    expect(probe.theme.pairId).toBe("forest");
    expect(probe.theme.colors.card).toBe(fixture.presets.forest.tokens.light.card);
  });

  it("T034 keeps the same Theme instance while version and mode are unchanged", () => {
    renderProvider(forestTheme());
    const first = probe.theme;
    act(() => probe.setTenantTheme(forestTheme()));
    expect(probe.theme).toBe(first);
  });

  it("T039 swaps the theme when a newer version arrives, without remounting", () => {
    renderProvider(forestTheme());
    const before = probe.theme;
    const recoloured: MobileTheme = {
      ...forestTheme("forest-v2"),
      light: { ...fixture.presets.forest.tokens.light, primary: "#123456" },
    };
    act(() => probe.setTenantTheme(recoloured));

    expect(probe.theme).not.toBe(before);
    expect(probe.theme.colors.primary).toBe("#123456");
  });

  it("T038 falls back to Alga when the bridge clears the theme on sign-out", () => {
    renderProvider(forestTheme());
    act(() => probe.setTenantTheme(null));
    expect(probe.theme).toBe(lightTheme);
    expect(probe.pairId).toBe("alga");
  });

  it("T040 renders the dark half of the pair for the dark preference", () => {
    renderProvider(forestTheme());
    act(() => probe.setPreference("dark"));

    expect(probe.theme.mode).toBe("dark");
    expect(probe.theme.colors.background).toBe(fixture.presets.forest.tokens.dark.background);
  });

  it("T040 follows the system scheme when the preference is system", () => {
    colorScheme.value = "dark";
    renderProvider(null);
    expect(probe.theme).toBe(darkTheme);
  });

  it("T043 persists the preference to the existing key and reads it back on remount", async () => {
    renderProvider(forestTheme());
    act(() => probe.setPreference("dark"));

    expect(secureStore.setItemAsync).toHaveBeenCalledWith("alga.mobile.theme.preference", "dark");

    secureStore.getItemAsync.mockResolvedValue("dark");
    await act(async () => {
      create(
        <ThemeProvider initialTenantTheme={forestTheme()}>
          <ProbeComponent />
        </ThemeProvider>,
      );
    });

    expect(probe.theme.mode).toBe("dark");
  });

  it("T041 exposes the active pairId and label for Settings", () => {
    renderProvider(forestTheme());
    expect(probe.pairId).toBe("forest");
    expect(probe.label).toBe("Forest");
  });
});
