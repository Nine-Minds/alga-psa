import React, { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { TicketRichTextEditor, type TicketRichTextEditorRef } from "./TicketRichTextEditor";
import type { MentionSuggestionItem } from "./MentionSuggestionList";
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
        content: "[]",
        editable: true,
        showToolbar: true,
        ...props,
      }),
    );
  });

  if (!renderer) {
    throw new Error("TicketRichTextEditor test renderer was not created");
  }

  return { ref, renderer };
}

function emitLoadEnd(): void {
  const props = __getLastWebViewProps();
  expect(props).not.toBeNull();
  act(() => {
    (props?.onLoadEnd as (() => void) | undefined)?.();
  });
}

function emitRuntimeMessage(message: unknown): void {
  const props = __getLastWebViewProps();
  expect(props).not.toBeNull();
  act(() => {
    (props?.onMessage as ((event: { nativeEvent: { data: string } }) => void) | undefined)?.({
      nativeEvent: { data: JSON.stringify(message) },
    });
  });
}

function getLastInjectedMessage(): Record<string, unknown> {
  const script = __getLastInjectedJavaScript();
  const match = script.match(/__ticketMobileEditorHandleNativeMessage\((.+)\); true;$/);
  expect(match).not.toBeNull();
  const rawEnvelope = JSON.parse(match?.[1] ?? '""') as string;
  return JSON.parse(rawEnvelope) as Record<string, unknown>;
}


describe("TicketRichTextEditor mention support", () => {
  afterEach(() => {
    __resetWebViewMock();
  });

  it("sends init message on load and accepts mention-query messages", () => {
    renderEditor();
    emitLoadEnd();

    const initMessage = getLastInjectedMessage();
    expect(initMessage).toHaveProperty("type", "init");

    // Emit a mention-query from the runtime — should not throw
    emitRuntimeMessage({
      type: "mention-query",
      payload: { active: true, query: "ali", from: 5, to: 9 },
    });
  });

  it("calls onMentionSearch when a mention-query with active=true arrives", async () => {
    const searchFn = vi.fn<(query: string, signal: AbortSignal) => Promise<MentionSuggestionItem[]>>().mockResolvedValue([
      { user_id: "u-1", username: "alice", display_name: "Alice", avatar_url: null },
    ]);

    renderEditor({ onMentionSearch: searchFn });
    emitLoadEnd();

    await act(async () => {
      emitRuntimeMessage({
        type: "mention-query",
        payload: { active: true, query: "ali", from: 5, to: 9 },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(searchFn).toHaveBeenCalledWith("ali", expect.any(AbortSignal));
  });

  it("does not call onMentionSearch when mention-query is inactive", () => {
    const searchFn = vi.fn<(query: string, signal: AbortSignal) => Promise<MentionSuggestionItem[]>>().mockResolvedValue([]);

    renderEditor({ onMentionSearch: searchFn });
    emitLoadEnd();

    emitRuntimeMessage({
      type: "mention-query",
      payload: { active: false, query: "", from: 0, to: 0 },
    });

    expect(searchFn).not.toHaveBeenCalled();
  });

  it("sends insert-mention command through the bridge when a mention is selected", async () => {
    const searchFn = vi.fn<(query: string, signal: AbortSignal) => Promise<MentionSuggestionItem[]>>().mockResolvedValue([
      { user_id: "u-1", username: "alice", display_name: "Alice", avatar_url: null },
    ]);

    const { renderer } = renderEditor({ onMentionSearch: searchFn });
    emitLoadEnd();

    // Trigger mention query
    await act(async () => {
      emitRuntimeMessage({
        type: "mention-query",
        payload: { active: true, query: "ali", from: 5, to: 9 },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Find the suggestion list and simulate selection
    const suggestionItems = renderer.root.findAll(
      (node) =>
        (node.type as string) === "Pressable"
        && typeof node.props.accessibilityLabel === "string"
        && node.props.accessibilityLabel.startsWith("Mention "),
    );

    expect(suggestionItems.length).toBeGreaterThan(0);

    act(() => {
      suggestionItems[0].props.onPress();
    });

    const message = getLastInjectedMessage();
    expect(message).toEqual({
      type: "command",
      payload: {
        command: "insert-mention",
        value: {
          userId: "u-1",
          username: "alice",
          displayName: "Alice",
          from: 5,
          to: 9,
        },
      },
    });
  });

  it("aborts previous search when a new mention query arrives", async () => {
    let capturedSignals: AbortSignal[] = [];
    const searchFn = vi.fn<(query: string, signal: AbortSignal) => Promise<MentionSuggestionItem[]>>()
      .mockImplementation(async (_q, signal) => {
        capturedSignals.push(signal);
        return [];
      });

    renderEditor({ onMentionSearch: searchFn });
    emitLoadEnd();

    // First query
    await act(async () => {
      emitRuntimeMessage({
        type: "mention-query",
        payload: { active: true, query: "a", from: 5, to: 7 },
      });
      await Promise.resolve();
    });

    // Second query — should abort the first
    await act(async () => {
      emitRuntimeMessage({
        type: "mention-query",
        payload: { active: true, query: "al", from: 5, to: 8 },
      });
      await Promise.resolve();
    });

    expect(capturedSignals.length).toBe(2);
    expect(capturedSignals[0].aborted).toBe(true);
    expect(capturedSignals[1].aborted).toBe(false);
  });

  it("clears mention results when mention-query becomes inactive", async () => {
    vi.useFakeTimers();
    const searchFn = vi.fn<(query: string, signal: AbortSignal) => Promise<MentionSuggestionItem[]>>().mockResolvedValue([
      { user_id: "u-1", username: "alice", display_name: "Alice", avatar_url: null },
    ]);

    const { renderer } = renderEditor({ onMentionSearch: searchFn });
    emitLoadEnd();

    // Activate mention query
    await act(async () => {
      emitRuntimeMessage({
        type: "mention-query",
        payload: { active: true, query: "ali", from: 5, to: 9 },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Deactivate
    emitRuntimeMessage({
      type: "mention-query",
      payload: { active: false, query: "", from: 0, to: 0 },
    });

    // Advance past the 150ms delayed clear
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // Should have no mention suggestion pressables
    const suggestionItems = renderer.root.findAll(
      (node) =>
        (node.type as string) === "Pressable"
        && typeof node.props.accessibilityLabel === "string"
        && node.props.accessibilityLabel.startsWith("Mention "),
    );
    expect(suggestionItems).toHaveLength(0);

    vi.useRealTimers();
  });

  it("does not render mention suggestion list when onMentionSearch is not provided", () => {
    const { renderer } = renderEditor();
    emitLoadEnd();

    emitRuntimeMessage({
      type: "mention-query",
      payload: { active: true, query: "ali", from: 5, to: 9 },
    });

    const suggestionItems = renderer.root.findAll(
      (node) =>
        (node.type as string) === "Pressable"
        && typeof node.props.accessibilityLabel === "string"
        && node.props.accessibilityLabel.startsWith("Mention "),
    );
    expect(suggestionItems).toHaveLength(0);
  });
});
