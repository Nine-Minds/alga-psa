import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const template = typeof opts?.defaultValue === "string" ? opts.defaultValue : key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ""));
    },
  }),
}));
vi.mock("../ThemeContext", async () => {
  const { lightTheme } = await import("../themes");
  return { useTheme: () => lightTheme };
});

import { DisplayTagBadges } from "./DisplayTagBadges";

const TAGS = [
  { tag_id: "d1", tag_text: "VIP", background_color: "#fef3c7", text_color: "#92400e" },
  { tag_id: "d2", tag_text: "POC" },
  { tag_id: "d3", tag_text: "Decision maker" },
];

function render(element: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(element);
  });
  return renderer;
}

const labels = (root: ReturnType<typeof create>["root"]) =>
  root.findAll((n) => typeof n.type === "string" && typeof n.props?.accessibilityLabel === "string").map((n) => n.props.accessibilityLabel as string);
const texts = (root: ReturnType<typeof create>["root"]) =>
  root.findAllByType(Text).map((n) => (Array.isArray(n.props.children) ? n.props.children.join("") : String(n.props.children)));

describe("DisplayTagBadges", () => {
  it("renders nothing without tags, so an empty list adds no layout", () => {
    expect(render(<DisplayTagBadges tags={[]} />).toJSON()).toBeNull();
    expect(render(<DisplayTagBadges tags={null} />).toJSON()).toBeNull();
  });

  it("shows the first maxBadges in the given order and folds the rest into +n with their names", () => {
    const { root } = render(<DisplayTagBadges tags={TAGS} maxBadges={2} />);
    expect(texts(root)).toEqual(["VIP", "POC", "+1"]);
    expect(labels(root)).toEqual(["Tag VIP", "Tag POC", "1 more tags: Decision maker"]);
  });

  it("shows every tag when they fit under the cap", () => {
    const { root } = render(<DisplayTagBadges tags={TAGS} maxBadges={4} />);
    expect(texts(root)).toEqual(["VIP", "POC", "Decision maker"]);
  });

  it("paints a chip with its stored colors", () => {
    const { root } = render(<DisplayTagBadges tags={[TAGS[0]]} />);
    const chip = root.find((n) => typeof n.type === "string" && n.props?.accessibilityLabel === "Tag VIP");
    expect(chip.props.style).toMatchObject({ backgroundColor: "#fef3c7" });
    expect(chip.findByType(Text).props.style).toMatchObject({ color: "#92400e" });
  });
});
