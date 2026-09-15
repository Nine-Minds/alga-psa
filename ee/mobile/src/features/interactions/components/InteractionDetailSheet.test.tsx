import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateInteractionMock = vi.fn();
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("../../../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../../../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../../schedule/components/InteractionEntryContext", () => ({ InteractionEntryContext: () => null }));
vi.mock("../../../ui/components/BottomSheet", () => ({
  BottomSheet: (props: Record<string, unknown>) => (props.visible ? React.createElement("MockBottomSheet", props, props.children as React.ReactNode) : null),
}));
vi.mock("../../../ui/components/Badge", () => ({ Badge: (props: Record<string, unknown>) => React.createElement("MockBadge", props) }));
vi.mock("../../../ui/formatters/dateTime", () => ({ formatDateTimeWithRelative: (iso: string) => `dt(${iso})` }));
vi.mock("../../../api/interactions", () => ({ updateInteraction: (...args: unknown[]) => updateInteractionMock(...args) }));
vi.mock("../../../logging/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { InteractionDetailSheet, pickTargetStatus } from "./InteractionDetailSheet";

const statuses = [
  { status_id: "open-b", name: "In progress", is_closed: false, is_default: false },
  { status_id: "open-a", name: "New", is_closed: false, is_default: true },
  { status_id: "done-a", name: "Done", is_closed: true, is_default: false },
  { status_id: "done-b", name: "Cancelled", is_closed: true, is_default: false },
];

const OPEN = { interaction_id: "i-1", type_id: "t", type_name: "Call", title: "Called Jane", interaction_date: "2026-09-11T10:00:00.000Z", duration: 12, user_name: "Sam", status_name: "New", is_status_closed: false };

function render(props: Partial<React.ComponentProps<typeof InteractionDetailSheet>> = {}) {
  const onUpdated = vi.fn();
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(React.createElement(InteractionDetailSheet, {
      interaction: OPEN,
      statuses,
      client: { request: vi.fn() } as never,
      apiKey: "key",
      onClose: vi.fn(),
      onUpdated,
      onOpenTicket: vi.fn(),
      ...props,
    }));
  });
  return { renderer, onUpdated };
}

const texts = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType(Text).map((n) => (Array.isArray(n.props.children) ? n.props.children.join("") : String(n.props.children)));
const primary = (renderer: ReactTestRenderer) => renderer.root.find((n) => String(n.type) === "Pressable" && ["detail.markDone", "detail.reopen"].includes(n.props.accessibilityLabel));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("pickTargetStatus", () => {
  it("prefers the default status of the requested kind, else the first one", () => {
    expect(pickTargetStatus(statuses, true)?.status_id).toBe("done-a");
    expect(pickTargetStatus(statuses, false)?.status_id).toBe("open-a");
    expect(pickTargetStatus([], true)).toBeNull();
  });
});

describe("InteractionDetailSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing until an interaction is selected", () => {
    const { renderer } = render({ interaction: null });
    expect(renderer.root.findAll((n) => n.props?.testID === "interaction-detail")).toHaveLength(0);
  });

  it("shows the entry's type, timing, duration, author, and status", () => {
    const { renderer } = render();
    const shown = texts(renderer);
    expect(shown).toContain("dt(2026-09-11T10:00:00.000Z)");
    expect(shown).toContain("detail.minutes");
    expect(shown).toContain("Sam");
    expect(renderer.root.findAll((n) => String(n.type) === "MockBadge").map((n) => n.props.label)).toEqual(["Call", "New"]);
    expect(primary(renderer).props.accessibilityLabel).toBe("detail.markDone");
  });

  it("marks an open entry done with the tenant's closed status and hands the update back", async () => {
    const updated = { ...OPEN, status_name: "Done", is_status_closed: true };
    updateInteractionMock.mockResolvedValue({ ok: true, data: { data: updated } });
    const { renderer, onUpdated } = render();

    await act(async () => primary(renderer).props.onPress());
    await flush();

    expect(updateInteractionMock).toHaveBeenCalledWith(expect.anything(), { apiKey: "key", interactionId: "i-1", data: { status_id: "done-a" } });
    expect(onUpdated).toHaveBeenCalledWith(updated);
  });

  it("reopens a closed entry with the default open status", async () => {
    updateInteractionMock.mockResolvedValue({ ok: true, data: { data: { ...OPEN, is_status_closed: false } } });
    const { renderer } = render({ interaction: { ...OPEN, status_name: "Done", is_status_closed: true } });

    expect(primary(renderer).props.accessibilityLabel).toBe("detail.reopen");
    await act(async () => primary(renderer).props.onPress());
    await flush();

    expect(updateInteractionMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: { status_id: "open-a" } }));
  });

  it("reports a failed update without touching the list", async () => {
    updateInteractionMock.mockResolvedValue({ ok: false, status: 500, error: { kind: "server", message: "boom" } });
    const { renderer, onUpdated } = render();

    await act(async () => primary(renderer).props.onPress());
    await flush();

    expect(texts(renderer)).toContain("detail.markDoneFailed");
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it("explains when no closed status is configured instead of calling the API", async () => {
    const { renderer } = render({ statuses: statuses.filter((s) => !s.is_closed) });

    await act(async () => primary(renderer).props.onPress());

    expect(updateInteractionMock).not.toHaveBeenCalled();
    expect(texts(renderer)).toContain("detail.noClosedStatus");
  });
});
