import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const active = vi.hoisted(() => ({ pairId: "alga" as string }));

vi.mock("react-native", () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => children ?? null;
  return {
    View: "View",
    Text: "Text",
    Pressable: "Pressable",
    Platform: { OS: "ios" },
    StyleSheet: { create: (styles: unknown) => styles },
    Stub,
  };
});

vi.mock("../ThemeContext", async () => {
  const { buildTheme } = await import("../themes");
  const fixture = (await import("../themeMath.fixture.json")) as any;
  const presets = fixture.default?.presets ?? fixture.presets;
  return {
    useTheme: () => buildTheme(presets[active.pairId].tokens.light, "light", {
      pairId: active.pairId as any,
      version: `${active.pairId}-hc-test`,
    }),
  };
});

import { Badge } from "./Badge";
import { Card } from "./Card";
import { KeyValue } from "../../features/ticketDetail/components/KeyValue";
import { buildTheme } from "../themes";
import fixtureJson from "../themeMath.fixture.json";

const fixture = fixtureJson as unknown as { presets: Record<string, { tokens: Record<string, any> }> };

function render(element: React.ReactElement): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(element);
  });
  return renderer as unknown as ReactTestRenderer;
}

function outerStyle(renderer: ReactTestRenderer): Record<string, unknown> {
  const node = renderer.root.findAll((n) => (n.type as unknown) === "View")[0];
  const style = node.props.style;
  return Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
}

const theme = (pairId: string) =>
  buildTheme(fixture.presets[pairId].tokens.light, "light", { pairId: pairId as any, version: `${pairId}-hc-expect` });

describe("high contrast treatment", () => {
  beforeEach(() => {
    active.pairId = "alga";
  });

  it("T055 sets highContrast only for the high-contrast pair", () => {
    expect(theme("high-contrast").highContrast).toBe(true);
    for (const pairId of Object.keys(fixture.presets)) {
      if (pairId === "high-contrast") continue;
      expect(theme(pairId).highContrast, pairId).toBe(false);
    }
  });

  it("T056 draws Card with the strong border only in high contrast", () => {
    expect(outerStyle(render(<Card><></></Card>)).borderColor).toBe(theme("alga").colors.border);

    active.pairId = "high-contrast";
    expect(outerStyle(render(<Card><></></Card>)).borderColor).toBe(theme("high-contrast").colors.borderStrong);
  });

  it("T056 draws KeyValue with the strong border only in high contrast", () => {
    expect(outerStyle(render(<KeyValue label="Status" value="Open" />)).borderColor)
      .toBe(theme("alga").colors.border);

    active.pairId = "high-contrast";
    expect(outerStyle(render(<KeyValue label="Status" value="Open" />)).borderColor)
      .toBe(theme("high-contrast").colors.borderStrong);
  });

  it("T057 outlines the Badge in its status colour only in high contrast", () => {
    expect(outerStyle(render(<Badge label="Open" tone="danger" />)).borderColor)
      .toBe(theme("alga").colors.badge.danger.border);

    active.pairId = "high-contrast";
    const highContrast = render(<Badge label="Open" tone="danger" />);
    expect(outerStyle(highContrast).borderColor).toBe(theme("high-contrast").colors.danger);
    expect(outerStyle(highContrast).borderWidth).toBe(1);
  });
});
