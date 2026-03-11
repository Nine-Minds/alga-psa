import React, { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { TicketRichTextEditor, type TicketRichTextEditorRef } from "./TicketRichTextEditor";
import {
  __getLastInjectedJavaScript,
  __getLastWebViewProps,
  __resetWebViewMock,
} from "../../../test/mocks/react-native-webview";

function renderEditor(
  props: Partial<React.ComponentProps<typeof TicketRichTextEditor>> = {},
): {
  ref: React.RefObject<TicketRichTextEditorRef | null>;
  renderer: ReactTestRenderer;
} {
  const ref = createRef<TicketRichTextEditorRef>();
  let renderer: ReactTestRenderer | null = null;

  act(() => {
    renderer = create(
      React.createElement(TicketRichTextEditor, {
        ref,
        content: "[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Hello\",\"styles\":{}}]}]",
        editable: true,
        showToolbar: true,
        ...props,
      }),
    );
  });

  if (!renderer) {
    throw new Error("TicketRichTextEditor test renderer was not created");
  }

  return {
    ref,
    renderer,
  };
}

function emitLoadEnd(): void {
  const props = __getLastWebViewProps();
  expect(props).not.toBeNull();

  act(() => {
    (props?.onLoadEnd as (() => void) | undefined)?.();
  });
}

function emitLoadStart(): void {
  const props = __getLastWebViewProps();
  expect(props).not.toBeNull();

  act(() => {
    (props?.onLoadStart as (() => void) | undefined)?.();
  });
}

function emitRuntimeMessage(message: unknown): void {
  const props = __getLastWebViewProps();
  expect(props).not.toBeNull();

  act(() => {
    (props?.onMessage as ((event: { nativeEvent: { data: string } }) => void) | undefined)?.({
      nativeEvent: {
        data: JSON.stringify(message),
      },
    });
  });
}

function findToolbarButton(
  renderer: ReactTestRenderer,
  label: string,
): {
  props: Record<string, unknown>;
} {
  return renderer.root.find(
    (node: { type: unknown; props: Record<string, unknown> }) =>
      node.type === "Pressable" && node.props.accessibilityLabel === `Editor command ${label}`,
  ) as { props: Record<string, unknown> };
}

function getLastInjectedMessage(): Record<string, unknown> {
  const script = __getLastInjectedJavaScript();
  const match = script.match(/__ticketMobileEditorHandleNativeMessage\((.+)\); true;$/);
  expect(match).not.toBeNull();

  const rawEnvelope = JSON.parse(match?.[1] ?? '""') as string;
  return JSON.parse(rawEnvelope) as Record<string, unknown>;
}

describe("TicketRichTextEditor", () => {
  afterEach(() => {
    __resetWebViewMock();
  });

  it("forwards focus() and blur() through the web runtime bridge", () => {
    const { ref } = renderEditor();
    emitLoadEnd();

    act(() => {
      ref.current?.focus();
    });
    expect(getLastInjectedMessage()).toEqual({
      type: "command",
      payload: {
        command: "focus",
      },
    });

    act(() => {
      ref.current?.blur();
    });
    expect(getLastInjectedMessage()).toEqual({
      type: "command",
      payload: {
        command: "blur",
      },
    });
  });

  it("forwards setContent() through the web runtime bridge", () => {
    const { ref } = renderEditor();
    emitLoadEnd();

    act(() => {
      ref.current?.setContent("Updated content");
    });

    expect(getLastInjectedMessage()).toEqual({
      type: "command",
      payload: {
        command: "set-content",
        value: "Updated content",
      },
    });
  });

  it("resolves getHTML() from the web runtime response path", async () => {
    const { ref } = renderEditor();
    emitLoadEnd();

    const htmlPromise = ref.current?.getHTML();
    expect(getLastInjectedMessage()).toEqual({
      type: "request",
      payload: {
        requestId: "ticket-mobile-editor-1",
        request: "get-html",
      },
    });

    emitRuntimeMessage({
      type: "response",
      payload: {
        requestId: "ticket-mobile-editor-1",
        request: "get-html",
        value: "<p>Hello</p>",
      },
    });

    await expect(htmlPromise).resolves.toBe("<p>Hello</p>");
  });

  it("resolves getJSON() from the web runtime response path", async () => {
    const { ref } = renderEditor();
    emitLoadEnd();

    const jsonPromise = ref.current?.getJSON();
    expect(getLastInjectedMessage()).toEqual({
      type: "request",
      payload: {
        requestId: "ticket-mobile-editor-1",
        request: "get-json",
      },
    });

    emitRuntimeMessage({
      type: "response",
      payload: {
        requestId: "ticket-mobile-editor-1",
        request: "get-json",
        value: {
          type: "doc",
          content: [],
        },
      },
    });

    await expect(jsonPromise).resolves.toEqual({
      type: "doc",
      content: [],
    });
  });

  it("keeps toolbar controls disabled until editor-ready has been received", () => {
    const { renderer } = renderEditor();

    expect(findToolbarButton(renderer, "Bold").props.disabled).toBe(true);
    expect(findToolbarButton(renderer, "Undo").props.disabled).toBe(true);

    emitLoadEnd();
    emitRuntimeMessage({
      type: "editor-ready",
      payload: {
        format: "blocknote",
        editable: true,
      },
    });
    emitRuntimeMessage({
      type: "state-change",
      payload: {
        ready: true,
        focused: false,
        editable: true,
        toolbar: {
          bold: false,
          italic: false,
          underline: false,
          bulletList: false,
          orderedList: false,
        },
        canUndo: false,
        canRedo: false,
      },
    });

    expect(findToolbarButton(renderer, "Bold").props.disabled).toBe(false);
    expect(findToolbarButton(renderer, "Undo").props.disabled).toBe(true);
  });

  it("blocks unexpected external navigation attempts from the editor runtime", () => {
    const onLinkPress = vi.fn();
    const onError = vi.fn();

    renderEditor({
      onLinkPress,
      onError,
    });

    const props = __getLastWebViewProps();
    expect(props).not.toBeNull();

    const allowed = (props?.onShouldStartLoadWithRequest as ((request: { url: string }) => boolean) | undefined)?.({
      url: "https://example.com/article",
    });

    expect(allowed).toBe(false);
    expect(onLinkPress).toHaveBeenCalledWith("https://example.com/article");
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "external-navigation-blocked",
      }),
    );
  });

  it("can auto-press the first rendered link for dev QA flows", () => {
    renderEditor({
      editable: false,
      qaAutoPressFirstLink: true,
    });

    emitLoadEnd();
    emitRuntimeMessage({
      type: "editor-ready",
      payload: {
        format: "blocknote",
        editable: false,
      },
    });

    expect(__getLastInjectedJavaScript()).toContain("document.querySelector('a[href]')");
    expect(__getLastInjectedJavaScript()).toContain("link.click()");
  });

  it("logs ready timing and request timeout failures only in development", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const testGlobals = globalThis as typeof globalThis & { __DEV__?: boolean };
    const previousDev = testGlobals.__DEV__;
    testGlobals.__DEV__ = true;

    try {
      const { ref } = renderEditor({
        requestTimeoutMs: 1,
      });

      emitLoadStart();
      emitLoadEnd();
      emitRuntimeMessage({
        type: "editor-ready",
        payload: {
          format: "blocknote",
          editable: true,
        },
      });

      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("[TicketRichTextEditor] ready in"));

      await expect(ref.current?.getHTML()).rejects.toThrow("timed out");
      expect(warnSpy).toHaveBeenCalledWith(
        "[TicketRichTextEditor]",
        "request-failed",
        expect.stringContaining("timed out"),
      );

      infoSpy.mockClear();
      warnSpy.mockClear();
      testGlobals.__DEV__ = false;

      const productionRender = renderEditor({
        requestTimeoutMs: 1,
      });
      emitLoadStart();
      emitLoadEnd();
      emitRuntimeMessage({
        type: "editor-ready",
        payload: {
          format: "blocknote",
          editable: true,
        },
      });

      await expect(productionRender.ref.current?.getHTML()).rejects.toThrow("timed out");
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      testGlobals.__DEV__ = previousDev;
      infoSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
