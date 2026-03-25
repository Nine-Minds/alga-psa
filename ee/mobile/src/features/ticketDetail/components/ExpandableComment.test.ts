import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { ExpandableComment, COMMENT_COLLAPSED_HEIGHT } from "./ExpandableComment";

// --- Mock TicketRichTextEditor -------------------------------------------
// Captures `onContentHeight` so tests can simulate different content heights.

let capturedOnContentHeight: ((e: { height: number }) => void) | null = null;

vi.mock("../../ticketRichText/TicketRichTextEditor", () => ({
  TicketRichTextEditor: (props: Record<string, unknown>) => {
    capturedOnContentHeight = props.onContentHeight as typeof capturedOnContentHeight;
    return React.createElement("MockEditor", { height: props.height });
  },
}));

// --- Theme stubs ---------------------------------------------------------

const colors = { primary: "#0f766e", text: "#111" } as any;
const typography = { caption: { fontSize: 12 } } as any;
const spacing = { xs: 4 } as any;
const t = (key: string) => key;

// --- Helpers -------------------------------------------------------------

function renderComment(opts?: { renderFooter?: React.ComponentProps<typeof ExpandableComment>["renderFooter"] }) {
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(
      React.createElement(ExpandableComment, {
        content: "test",
        loadingLabel: "Loading",
        colors,
        typography,
        spacing,
        t,
        renderFooter: opts?.renderFooter,
      }),
    );
  });
  return renderer!;
}

function simulateContentHeight(height: number) {
  expect(capturedOnContentHeight).not.toBeNull();
  act(() => capturedOnContentHeight!({ height }));
}

function findByType(root: ReactTestRenderer, type: string) {
  return root.root.findAllByType(type as any);
}

function findPressables(root: ReactTestRenderer) {
  // In RN mock, Pressable renders as "Pressable"
  return root.root.findAllByType("Pressable" as any);
}

// --- Tests ---------------------------------------------------------------

describe("ExpandableComment", () => {
  beforeEach(() => {
    capturedOnContentHeight = null;
  });

  it("exports COMMENT_COLLAPSED_HEIGHT", () => {
    expect(COMMENT_COLLAPSED_HEIGHT).toBe(96);
  });

  it("does not show see-more when content fits", () => {
    const renderer = renderComment();
    simulateContentHeight(80); // below threshold

    const pressables = findPressables(renderer);
    expect(pressables).toHaveLength(0);
  });

  it("shows see-more when content exceeds collapsed height", () => {
    const renderer = renderComment();
    simulateContentHeight(200); // above 96

    const pressables = findPressables(renderer);
    expect(pressables).toHaveLength(1);
    expect(pressables[0].props.accessibilityLabel).toBe("comments.seeMore");
  });

  it("toggles between see-more and see-less on press", () => {
    const renderer = renderComment();
    simulateContentHeight(200);

    let pressables = findPressables(renderer);
    expect(pressables[0].props.accessibilityLabel).toBe("comments.seeMore");

    // Press to expand
    act(() => pressables[0].props.onPress());
    pressables = findPressables(renderer);
    expect(pressables[0].props.accessibilityLabel).toBe("comments.seeLess");

    // Press to collapse
    act(() => pressables[0].props.onPress());
    pressables = findPressables(renderer);
    expect(pressables[0].props.accessibilityLabel).toBe("comments.seeMore");
  });

  it("passes collapsed height to editor when not expanded", () => {
    const renderer = renderComment();
    simulateContentHeight(200);

    const editor = renderer.root.findByType("MockEditor" as any);
    expect(editor.props.height).toBe(COMMENT_COLLAPSED_HEIGHT);
  });

  it("passes full content height to editor when expanded", () => {
    const renderer = renderComment();
    simulateContentHeight(200);

    const pressables = findPressables(renderer);
    act(() => pressables[0].props.onPress()); // expand

    const editor = renderer.root.findByType("MockEditor" as any);
    expect(editor.props.height).toBe(200);
  });

  it("calls renderFooter with expansion controls when provided", () => {
    const footerSpy = vi.fn().mockReturnValue(null);
    const renderer = renderComment({ renderFooter: footerSpy });
    simulateContentHeight(200);

    expect(footerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        needsExpansion: true,
        expanded: false,
        toggle: expect.any(Function),
      }),
    );

    // No default Pressable rendered when renderFooter is provided
    const pressables = findPressables(renderer);
    expect(pressables).toHaveLength(0);
  });

  it("renderFooter toggle controls expansion state", () => {
    let lastToggle: (() => void) | null = null;
    const footerSpy = vi.fn((opts: { toggle: () => void }) => {
      lastToggle = opts.toggle;
      return null;
    });
    renderComment({ renderFooter: footerSpy });
    simulateContentHeight(200);

    // Initially not expanded
    expect(footerSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ expanded: false }),
    );

    // Toggle via the callback
    act(() => lastToggle!());
    expect(footerSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ expanded: true }),
    );

    // Toggle back
    act(() => lastToggle!());
    expect(footerSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ expanded: false }),
    );
  });
});
