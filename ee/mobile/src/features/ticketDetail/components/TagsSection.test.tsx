import React from "react";
import { Text } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import type { TicketTag } from "../../../api/tags";

vi.mock("../../../ui/components/Card", () => ({
  Card: (props: Record<string, unknown>) =>
    React.createElement("MockCard", props, props.children as React.ReactNode),
}));

vi.mock("../../../ui/components/SectionHeader", () => ({
  SectionHeader: (props: Record<string, unknown>) =>
    React.createElement(
      "MockSectionHeader",
      props,
      [
        React.createElement(Text, { key: "title" }, props.title as React.ReactNode),
        props.action as React.ReactNode,
      ],
    ),
}));

import { TagsSection, getReadableTextColor, getTagChipColors } from "./TagsSection";

function render(
  props: Partial<React.ComponentProps<typeof TagsSection>> = {},
): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined;
  const element = React.createElement(TagsSection, {
    tags: [],
    loading: false,
    hidden: false,
    error: null,
    actionError: null,
    updating: false,
    onAddPress: () => undefined,
    onRemoveTag: () => undefined,
    ...props,
  } as React.ComponentProps<typeof TagsSection>);
  act(() => {
    renderer = create(element);
  });
  if (renderer === undefined) {
    throw new Error("Renderer was not created");
  }
  return renderer;
}

function styleOf(node: ReactTestInstance): Record<string, unknown> {
  const s = node.props.style;
  return (Array.isArray(s) ? Object.assign({}, ...s) : s ?? {}) as Record<string, unknown>;
}

function textContents(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((n) => (n.type as string) === "Text")
    .map((n) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.map((x) => String(x ?? "")).join("") : String(c ?? "");
    });
}

function pressableByLabel(renderer: ReactTestRenderer, label: string): ReactTestInstance[] {
  return renderer.root.findAll(
    (n) => (n.type as string) === "Pressable" && n.props.accessibilityLabel === label,
  );
}

function tagChip(renderer: ReactTestRenderer, tagText: string): ReactTestInstance {
  const chip = renderer.root
    .findAll((n) => (n.type as string) === "View")
    .find((n) => n.props.accessibilityLabel === `Tag ${tagText}`);
  if (!chip) throw new Error(`chip for ${tagText} not found`);
  return chip;
}

function makeTag(id: string, text: string, over: Partial<TicketTag> = {}): TicketTag {
  return { tag_id: id, tag_text: text, ...over };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("TagsSection", () => {
  it("renders nothing when hidden", () => {
    const renderer = render({ hidden: true, tags: [makeTag("m1", "vip")] });
    expect(renderer.toJSON()).toBeNull();
  });

  it("renders the empty state when there are no tags", () => {
    const renderer = render();
    expect(textContents(renderer)).toContain("No tags.");
  });

  it("renders a chip per tag with its text", () => {
    const renderer = render({ tags: [makeTag("m1", "vip"), makeTag("m2", "billing")] });
    const texts = textContents(renderer);
    expect(texts).toContain("vip");
    expect(texts).toContain("billing");
  });

  it("applies the tag's background color and a readable fallback text color", () => {
    const renderer = render({
      tags: [makeTag("m1", "dark", { background_color: "#11182B", text_color: null })],
    });
    const chip = tagChip(renderer, "dark");
    expect(styleOf(chip).backgroundColor).toBe("#11182B");
    const label = chip.findAll((n) => (n.type as string) === "Text")[0];
    expect(styleOf(label).color).toBe("#FFFFFF");
  });

  it("uses the tag's own text color when provided", () => {
    const renderer = render({
      tags: [makeTag("m1", "vip", { background_color: "#FEF3C7", text_color: "#92400E" })],
    });
    const chip = tagChip(renderer, "vip");
    expect(styleOf(chip).backgroundColor).toBe("#FEF3C7");
    const label = chip.findAll((n) => (n.type as string) === "Text")[0];
    expect(styleOf(label).color).toBe("#92400E");
  });

  it("falls back to theme chip colors when no color is set", () => {
    const renderer = render({ tags: [makeTag("m1", "plain")] });
    const chip = tagChip(renderer, "plain");
    expect(styleOf(chip).backgroundColor).not.toBeUndefined();
    expect(styleOf(chip).backgroundColor).not.toBe("#11182B");
  });

  it("calls onRemoveTag for the chip's remove button", () => {
    const onRemoveTag = vi.fn();
    const tags = [makeTag("m1", "vip"), makeTag("m2", "billing")];
    const renderer = render({ tags, onRemoveTag });

    const remove = pressableByLabel(renderer, "Remove tag billing");
    expect(remove).toHaveLength(1);
    act(() => remove[0].props.onPress());

    expect(onRemoveTag).toHaveBeenCalledTimes(1);
    expect(onRemoveTag.mock.calls[0][0]).toMatchObject({ tag_id: "m2", tag_text: "billing" });
  });

  it("disables remove buttons while updating", () => {
    const renderer = render({ tags: [makeTag("m1", "vip")], updating: true });
    const remove = pressableByLabel(renderer, "Remove tag vip");
    expect(remove[0].props.disabled).toBe(true);
  });

  it("calls onAddPress from the add affordance", () => {
    const onAddPress = vi.fn();
    const renderer = render({ onAddPress });

    const add = pressableByLabel(renderer, "Add tag");
    expect(add).toHaveLength(1);
    act(() => add[0].props.onPress());

    expect(onAddPress).toHaveBeenCalledTimes(1);
  });

  it("renders load and action errors", () => {
    const renderer = render({ error: "load failed", actionError: "remove failed" });
    const texts = textContents(renderer);
    expect(texts).toContain("load failed");
    expect(texts).toContain("remove failed");
  });
});

describe("getReadableTextColor", () => {
  it("returns white on dark backgrounds", () => {
    expect(getReadableTextColor("#000000")).toBe("#FFFFFF");
    expect(getReadableTextColor("#1E3A8A")).toBe("#FFFFFF");
  });

  it("returns a dark color on light backgrounds", () => {
    expect(getReadableTextColor("#FFFFFF")).toBe("#1F2937");
    expect(getReadableTextColor("#FEF3C7")).toBe("#1F2937");
  });
});

describe("getTagChipColors", () => {
  const fallback = { bg: "#EEE-bg", text: "#333-text", border: "#CCC-border" };

  it("uses the fallback palette when background_color is missing or invalid", () => {
    expect(getTagChipColors({ background_color: null, text_color: null }, fallback)).toEqual({
      backgroundColor: "#EEE-bg",
      textColor: "#333-text",
      borderColor: "#CCC-border",
    });
    expect(getTagChipColors({ background_color: "red", text_color: "#FFFFFF" }, fallback).backgroundColor).toBe("#EEE-bg");
  });

  it("derives a readable text color when only the background is set", () => {
    expect(getTagChipColors({ background_color: "#000000", text_color: null }, fallback)).toEqual({
      backgroundColor: "#000000",
      textColor: "#FFFFFF",
      borderColor: "#000000",
    });
  });

  it("keeps both colors when provided", () => {
    expect(getTagChipColors({ background_color: "#FEF3C7", text_color: "#92400E" }, fallback)).toEqual({
      backgroundColor: "#FEF3C7",
      textColor: "#92400E",
      borderColor: "#FEF3C7",
    });
  });
});
