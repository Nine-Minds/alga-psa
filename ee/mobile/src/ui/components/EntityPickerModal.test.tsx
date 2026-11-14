import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (typeof opts?.defaultValue === "string" ? opts.defaultValue : key),
  }),
}));
vi.mock("../ThemeContext", async () => {
  const { lightTheme } = await import("../themes");
  return { useTheme: () => lightTheme };
});
vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));
vi.mock("./Avatar", () => ({ Avatar: () => null }));

import { EntityPickerModal } from "./EntityPickerModal";

function render(element: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(element);
  });
  return renderer;
}

const texts = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType(Text).map((n) => (Array.isArray(n.props.children) ? n.props.children.join("") : String(n.props.children)));

describe("EntityPickerModal chip tags", () => {
  it("shows a row's display tags after its label, and nothing for rows without", () => {
    const renderer = render(
      <EntityPickerModal
        visible
        title="Client"
        items={[
          { id: "c1", label: "Acme", subtitle: "acme@example.com", tags: [{ tag_id: "d1", tag_text: "VIP" }] },
          { id: "c2", label: "Globex" },
        ]}
        loading={false}
        error={null}
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(texts(renderer)).toEqual(expect.arrayContaining(["Acme", "VIP", "Globex"]));
    expect(renderer.root.findAll((n) => typeof n.type === "string" && n.props?.testID === "display-tag-badges")).toHaveLength(1);
  });
});
