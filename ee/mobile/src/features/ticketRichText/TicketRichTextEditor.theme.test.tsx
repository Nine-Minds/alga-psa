import fs from "node:fs";
import path from "node:path";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const active = vi.hoisted(() => ({ mode: "light" as "light" | "dark" }));

vi.mock("../../ui/ThemeContext", async () => {
  const { lightTheme, darkTheme } = await import("../../ui/themes");
  return { useTheme: () => (active.mode === "dark" ? darkTheme : lightTheme) };
});

import { TicketRichTextEditor } from "./TicketRichTextEditor";
import { ExpandableComment } from "../ticketDetail/components/ExpandableComment";
import { darkTheme, lightTheme } from "../../ui/themes";
import {
  __getInjectedJavaScripts,
  __getLastWebViewProps,
  __resetWebViewMock,
} from "../../../test/mocks/react-native-webview";

function injectedMessages(): Array<Record<string, any>> {
  return __getInjectedJavaScripts().flatMap((script) => {
    const match = script.match(/__ticketMobileEditorHandleNativeMessage\((.+)\); true;$/);
    if (!match) return [];
    return [JSON.parse(JSON.parse(match[1]) as string) as Record<string, any>];
  });
}

function themeMessages() {
  return injectedMessages().filter((message) => message.type === "set-theme");
}

function emitLoadEnd(): void {
  const props = __getLastWebViewProps();
  act(() => {
    (props?.onLoadEnd as (() => void) | undefined)?.();
  });
}

function renderEditor(props: Record<string, unknown> = {}): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(
      React.createElement(TicketRichTextEditor, {
        content: "Hello",
        editable: true,
        ...props,
      } as any),
    );
  });
  return renderer as unknown as ReactTestRenderer;
}

describe("TicketRichTextEditor theming", () => {
  afterEach(() => {
    __resetWebViewMock();
    active.mode = "light";
  });

  it("T052 posts the active theme once the editor has loaded", () => {
    renderEditor();
    emitLoadEnd();

    const messages = themeMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].payload).toEqual({
      mode: "light",
      background: lightTheme.colors.card,
      text: lightTheme.colors.text,
      textSecondary: lightTheme.colors.textSecondary,
      link: lightTheme.colors.primary,
      mentionBackground: lightTheme.colors.badge.info.bg,
      mentionText: lightTheme.colors.badge.info.text,
    });
  });

  it("T052 posts again when the active theme changes", () => {
    const renderer = renderEditor();
    emitLoadEnd();
    expect(themeMessages()).toHaveLength(1);

    active.mode = "dark";
    act(() => {
      renderer.update(
        React.createElement(TicketRichTextEditor, { content: "Hello", editable: true } as any),
      );
    });

    const messages = themeMessages();
    expect(messages).toHaveLength(2);
    expect(messages[1].payload.mode).toBe("dark");
    expect(messages[1].payload.background).toBe(darkTheme.colors.card);
  });

  it("T053 posts the dark colours for a read-only comment body", () => {
    active.mode = "dark";
    renderEditor({ editable: false, scrollEnabled: false });
    emitLoadEnd();

    const [message] = themeMessages();
    expect(message.payload.background).toBe(darkTheme.colors.card);
    expect(message.payload.text).toBe(darkTheme.colors.text);
  });

  it("T053 pre-paints the web view with the theme variables before it loads", () => {
    active.mode = "dark";
    renderEditor({ editable: false });

    const source = __getLastWebViewProps()?.source as { html: string };
    expect(source.html).toContain('<style id="rn-editor-theme">');
    expect(source.html).toContain(`--editor-bg: ${darkTheme.colors.card};`);
    expect(source.html).not.toContain("rn-dark-mode");
  });

  it("T054 themes comment bodies rendered through ExpandableComment", () => {
    active.mode = "dark";
    act(() => {
      create(
        React.createElement(ExpandableComment, {
          content: "A comment",
          loadingLabel: "Loading",
          colors: darkTheme.colors,
          typography: darkTheme.typography,
          spacing: darkTheme.spacing,
          t: (key: string) => key,
        } as any),
      );
    });
    emitLoadEnd();

    const [message] = themeMessages();
    expect(message.payload.background).toBe(darkTheme.colors.card);
    expect(message.payload.mentionText).toBe(darkTheme.colors.badge.info.text);
  });

  it("T054 renders description and comment bodies through the themed editor", () => {
    const dir = path.resolve(__dirname, "../ticketDetail/components");
    for (const file of ["DescriptionSection.tsx", "CommentsSection.tsx"]) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      expect(source, file).toContain("TicketRichTextEditor");
    }
  });
});
