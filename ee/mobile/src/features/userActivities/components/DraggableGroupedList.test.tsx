import React from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { Activity, ActivityGroup } from "../../../api/activities";
import { lightTheme } from "../../../ui/themes";

Object.assign(globalThis, { React });

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      let out = (opts?.defaultValue as string | undefined) ?? key;
      for (const [n, v] of Object.entries(opts ?? {})) out = out.replaceAll(`{{${n}}}`, String(v));
      return out;
    },
  }),
}));
vi.mock("../../../ui/ThemeContext", async () => {
  const { lightTheme: theme } = await import("../../../ui/themes");
  return { useTheme: () => theme };
});

type Handlers = Partial<Record<"onStart" | "onUpdate" | "onEnd" | "onFinalize", (e?: unknown) => void>>;

vi.mock("react-native-gesture-handler", async () => {
  const ReactLocal = await import("react");
  const Pan = () => {
    const handlers: Handlers = {};
    const builder: Record<string, unknown> = { handlers };
    builder.activateAfterLongPress = () => builder;
    for (const name of ["onStart", "onUpdate", "onEnd", "onFinalize"] as const) {
      builder[name] = (fn: (e?: unknown) => void) => {
        handlers[name] = fn;
        return builder;
      };
    }
    return builder;
  };
  return {
    Gesture: { Pan },
    GestureDetector: ({ gesture, children }: { gesture: unknown; children: React.ReactNode }) =>
      ReactLocal.createElement("GestureDetector", { gesture }, children),
  };
});

vi.mock("react-native-reanimated", async () => {
  const ReactLocal = await import("react");
  const AnimatedView = (props: Record<string, unknown>) =>
    ReactLocal.createElement("AnimatedView", props, props.children as React.ReactNode);
  return {
    default: { View: AnimatedView },
    runOnJS: (fn: (...a: unknown[]) => unknown) => fn,
    useSharedValue: (initial: unknown) => ReactLocal.useRef({ value: initial }).current,
    useAnimatedStyle: (fn: () => unknown) => fn(),
    withTiming: (v: unknown) => v,
  };
});

import { DraggableGroupedList } from "./DraggableGroupedList";

function act1(id: string): Activity {
  return {
    id,
    title: `Title ${id}`,
    status: "open",
    priority: "low",
    sourceId: id,
    sourceType: "ticket",
    actions: [],
    tenant: "t",
    createdAt: "",
    updatedAt: "",
    type: "ticket",
  } as Activity;
}

const groups: ActivityGroup[] = [
  { key: "g1", label: "Group 1", count: 2, activities: [act1("a"), act1("b")] },
  { key: "g2", label: "Group 2", count: 1, activities: [act1("c")] },
];

type Props = React.ComponentProps<typeof DraggableGroupedList>;

function render(overrides: Partial<Props> = {}) {
  const props: Props = {
    theme: lightTheme,
    groups,
    collapsed: new Set(),
    onToggleCollapsed: vi.fn(),
    titleForGroup: (g) => `T:${g.label}`,
    onPressActivity: vi.fn(),
    onCommit: vi.fn(),
    refreshing: false,
    onRefresh: vi.fn(),
    header: <Text>HEADER</Text>,
    emptyComponent: <Text>EMPTY</Text>,
    dragHint: "Long-press to drag",
    ...overrides,
  };
  let r!: ReactTestRenderer;
  act(() => {
    r = create(<DraggableGroupedList {...props} />);
  });
  return { r, props };
}

function texts(r: ReactTestRenderer) {
  return r.root.findAllByType(Text).map((n) => String(n.props.children));
}

function layoutAll(r: ReactTestRenderer) {
  const layout = (h: number) => ({ nativeEvent: { layout: { height: h } } });
  for (const header of r.root.findAll((n) => n.type === Pressable && n.props.accessibilityState?.expanded !== undefined)) {
    header.props.onLayout(layout(40));
  }
  for (const item of r.root.findAll((n) => (n.type as unknown) === "AnimatedView")) {
    item.props.onLayout(layout(100));
  }
}

function gestures(r: ReactTestRenderer): Handlers[] {
  return r.root
    .findAll((n) => (n.type as unknown) === "GestureDetector")
    .map((n) => (n.props.gesture as { handlers: Handlers }).handlers);
}

describe("DraggableGroupedList", () => {
  it("renders the empty component when there are no groups", () => {
    const { r } = render({ groups: [] });
    const all = texts(r);
    expect(all).toContain("HEADER");
    expect(all).toContain("EMPTY");
    expect(all).not.toContain("Long-press to drag");
  });

  it("renders headers with counts, rows, and hides items of collapsed groups", () => {
    const { r, props } = render({ collapsed: new Set(["g2"]) });
    const all = texts(r);
    expect(all).toEqual(expect.arrayContaining(["Long-press to drag", "T:Group 1", "2", "T:Group 2", "1", "Title a", "Title b"]));
    expect(all).not.toContain("Title c");
    const g2 = r.root.findAll((n) => n.type === Pressable && n.props.accessibilityLabel === "T:Group 2")[0];
    expect(g2.props.accessibilityState).toEqual({ expanded: false });
    act(() => g2.props.onPress());
    expect(props.onToggleCollapsed).toHaveBeenCalledWith("g2");
  });

  it("forwards taps on rows and pull-to-refresh", () => {
    const { r, props } = render();
    const row = r.root.findAll((n) => n.type === Pressable && n.props.accessibilityLabel === "Ticket: Title b")[0];
    act(() => row.props.onPress());
    expect(props.onPressActivity).toHaveBeenCalledWith(groups[0].activities[1]);
    const scroll = r.root.findByType(ScrollView);
    scroll.props.refreshControl.props.onRefresh();
    expect(props.onRefresh).toHaveBeenCalled();
  });

  it("dragging a card into another group locks scroll, shows the drop indicator, and commits a move", () => {
    const { r, props } = render();
    layoutAll(r);
    const [first] = gestures(r);
    act(() => first.onStart!());
    expect(r.root.findByType(ScrollView).props.scrollEnabled).toBe(false);
    // Card "a" centre at 90; drag down to the slot after "c" (40+100+100+40+100 = 380).
    act(() => first.onUpdate!({ translationY: 290 }));
    const indicator = r.root.findAll((n) => (n.type as unknown) === "View" && n.props.pointerEvents === "none" && n.props.style?.height === 2);
    expect(indicator).toHaveLength(1);
    expect(indicator[0].props.style.top).toBe(379);
    act(() => {
      first.onEnd!();
      first.onFinalize!();
    });
    expect(r.root.findByType(ScrollView).props.scrollEnabled).toBe(true);
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    const plan = (props.onCommit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(plan.mutation).toEqual(expect.objectContaining({ kind: "move", groupKey: "g2", activityId: "a" }));
  });

  it("dropping a card back where it started does not commit", () => {
    const { r, props } = render();
    layoutAll(r);
    const [first] = gestures(r);
    act(() => {
      first.onStart!();
      first.onUpdate!({ translationY: 5 });
      first.onEnd!();
    });
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("ignores updates for a card that is not the active one", () => {
    const { r, props } = render();
    layoutAll(r);
    const [first, second] = gestures(r);
    act(() => {
      first.onStart!();
      second.onUpdate!({ translationY: 500 });
      first.onEnd!();
    });
    expect(props.onCommit).not.toHaveBeenCalled();
  });
});
