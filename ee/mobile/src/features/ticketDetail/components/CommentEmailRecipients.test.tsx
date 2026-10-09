import React from "react";
import { Pressable, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../ui/ThemeContext", () => ({
  useTheme: () => ({
    colors: { text: "#000", textSecondary: "#999", primary: "#00f", border: "#ccc", danger: "#f00" },
    spacing: { xs: 2, sm: 4, md: 8 },
    typography: { caption: { fontSize: 12 } },
  }),
}));

import { CommentEmailRecipients } from "./CommentEmailRecipients";

async function flush() {
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

function render(props: Partial<Parameters<typeof CommentEmailRecipients>[0]>): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(React.createElement(CommentEmailRecipients, {
      isInternal: false,
      cc: [],
      bcc: [],
      onChangeCc: vi.fn(),
      onChangeBcc: vi.fn(),
      ...props,
    } as Parameters<typeof CommentEmailRecipients>[0]));
  });
  if (!renderer) throw new Error("Renderer was not created");
  return renderer;
}

function expand(renderer: ReactTestRenderer) {
  const toggle = renderer.root
    .findAllByType(Pressable)
    .find((node) => node.props.testID === "comment-cc-bcc-toggle");
  act(() => toggle!.props.onPress());
}

function typeInCc(renderer: ReactTestRenderer, text: string) {
  const input = renderer.root
    .findAllByType(TextInput)
    .find((node) => node.props.testID === "comment-cc-input");
  act(() => input!.props.onChangeText(text));
}

describe("mobile Cc/Bcc recipients", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("T063: a typed name offers the ticket client's contacts and picking one adds a chip", async () => {
    const onChangeCc = vi.fn();
    const searchRecipients = vi.fn(async () => [
      { email: "jane@client.com", name: "Jane Doe" },
    ]);
    const renderer = render({ onChangeCc, searchRecipients });
    expand(renderer);

    typeInCc(renderer, "ja");
    await flush();

    expect(searchRecipients).toHaveBeenCalledWith("ja", expect.anything());
    const suggestion = renderer.root
      .findAllByType(Pressable)
      .find((node) => node.props.testID === "comment-cc-suggestion-jane@client.com");
    expect(suggestion).toBeDefined();

    act(() => suggestion!.props.onPress());
    expect(onChangeCc).toHaveBeenCalledWith(["jane@client.com"]);
  });

  it("T063: a typed address needs no lookup, and an internal note hides the whole section", async () => {
    const searchRecipients = vi.fn(async () => []);
    const renderer = render({ searchRecipients });
    expand(renderer);

    typeInCc(renderer, "vendor@acme.com");
    await flush();
    expect(searchRecipients).not.toHaveBeenCalled();

    const internal = render({ isInternal: true, searchRecipients });
    expect(internal.root.findAllByType(Pressable)).toHaveLength(0);
  });
});
