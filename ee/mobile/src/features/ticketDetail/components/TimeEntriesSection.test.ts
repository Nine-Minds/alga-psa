import React from "react";
import { Pressable, Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getTicketTimeEntriesMock = vi.fn();

const translate = (key: string, opts?: Record<string, unknown>) => {
  const fallback = (opts?.defaultValue as string | undefined) ?? key;
  if (opts && typeof opts.count === "number") {
    return `${fallback}|count=${opts.count}|duration=${opts.duration ?? ""}`;
  }
  return fallback;
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock("../../../api/timeEntries", () => ({
  getTicketTimeEntries: (...args: unknown[]) => getTicketTimeEntriesMock(...args),
}));

function MockBadge(props: Record<string, unknown>) {
  return React.createElement("MockBadge", props, props.label as React.ReactNode);
}
vi.mock("../../../ui/components/Badge", () => ({ Badge: MockBadge }));

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

vi.mock("../../../ui/formatters/dateTime", () => ({
  formatDateTimeWithRelative: (value: unknown) => `formatted(${String(value)})`,
}));

import { TimeEntriesSection } from "./TimeEntriesSection";

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderSection(props?: {
  ticketId?: string;
  meUserId?: string | null;
  refreshKey?: number;
  onAddPress?: () => void;
  client?: unknown;
  apiKey?: string | null;
}): ReactTestRenderer {
  const client =
    props && "client" in props ? props.client : { request: vi.fn() };
  const apiKey = props && "apiKey" in props ? props.apiKey : "api-key-1";

  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(
      React.createElement(TimeEntriesSection, {
        client: client as any,
        apiKey: apiKey ?? null,
        ticketId: props?.ticketId ?? "ticket-1",
        meUserId: props?.meUserId,
        refreshKey: props?.refreshKey,
        onAddPress: props?.onAddPress,
      }),
    );
  });
  if (!renderer) throw new Error("Renderer was not created");
  return renderer;
}

function getTextContent(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => {
    const value = node.props.children;
    if (Array.isArray(value)) return value.map((v) => String(v)).join("");
    return String(value);
  });
}

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    entries: [],
    ownTotalMinutes: 0,
    ownEntryCount: 0,
    othersTotalMinutes: 0,
    othersEntryCount: 0,
    othersVisibleMinutes: 0,
    othersVisibleCount: 0,
    othersHiddenMinutes: 0,
    othersHiddenCount: 0,
    totalMinutes: 0,
    ...overrides,
  };
}

describe("TimeEntriesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTicketTimeEntriesMock.mockResolvedValue({
      ok: true,
      data: { data: makeSummary() },
    });
  });

  it("calls getTicketTimeEntries with the ticket id and api key", async () => {
    renderSection();
    await flushAsyncWork();

    expect(getTicketTimeEntriesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ apiKey: "api-key-1", ticketId: "ticket-1" }),
    );
  });

  it("does not call the API when client is missing", async () => {
    renderSection({ client: null });
    await flushAsyncWork();
    expect(getTicketTimeEntriesMock).not.toHaveBeenCalled();
  });

  it("shows the empty state when no entries are logged", async () => {
    const renderer = renderSection();
    await flushAsyncWork();
    expect(getTextContent(renderer)).toContain(
      "No time has been logged on this ticket yet.",
    );
  });

  it("renders the total badge using totalMinutes", async () => {
    getTicketTimeEntriesMock.mockResolvedValue({
      ok: true,
      data: {
        data: makeSummary({
          totalMinutes: 90,
          ownTotalMinutes: 90,
          ownEntryCount: 1,
          entries: [
            {
              entry_id: "te-1",
              user_id: "user-1",
              user_name: "Me",
              start_time: "2026-05-05T09:00:00Z",
              end_time: "2026-05-05T10:30:00Z",
              work_date: "2026-05-05",
              billable_duration: 90,
              notes: null,
              approval_status: "DRAFT",
              service_id: "svc-1",
              service_name: "Support",
              is_own: true,
            },
          ],
        }),
      },
    });

    const renderer = renderSection({ meUserId: "user-1" });
    await flushAsyncWork();

    const badges = renderer.root.findAllByType(MockBadge);
    expect(badges.some((b) => b.props.label === "1 h 30 m")).toBe(true);
  });

  it("groups entries by 'mine' vs 'others' using meUserId", async () => {
    getTicketTimeEntriesMock.mockResolvedValue({
      ok: true,
      data: {
        data: makeSummary({
          totalMinutes: 75,
          ownTotalMinutes: 30,
          ownEntryCount: 1,
          othersTotalMinutes: 45,
          othersEntryCount: 1,
          othersVisibleMinutes: 45,
          othersVisibleCount: 1,
          entries: [
            {
              entry_id: "te-mine",
              user_id: "user-1",
              user_name: "Me",
              start_time: "2026-05-05T09:00:00Z",
              end_time: "2026-05-05T09:30:00Z",
              work_date: "2026-05-05",
              billable_duration: 30,
              notes: "did the thing",
              approval_status: "DRAFT",
              service_id: "svc-1",
              service_name: "Support",
              is_own: true,
            },
            {
              entry_id: "te-other",
              user_id: "user-2",
              user_name: "Bob",
              start_time: "2026-05-05T10:00:00Z",
              end_time: "2026-05-05T10:45:00Z",
              work_date: "2026-05-05",
              billable_duration: 45,
              notes: null,
              approval_status: "APPROVED",
              service_id: "svc-2",
              service_name: "Onsite",
              is_own: false,
            },
          ],
        }),
      },
    });

    const renderer = renderSection({ meUserId: "user-1" });
    await flushAsyncWork();

    // Expand the "others" group (mine is open by default)
    const othersToggle = renderer.root
      .findAllByType(Pressable)
      .find((node) => {
        const label = node.props.accessibilityLabel as string | undefined;
        return typeof label === "string" && label.startsWith("Other team members");
      });
    expect(othersToggle).toBeTruthy();
    await act(async () => {
      othersToggle!.props.onPress();
    });

    const text = getTextContent(renderer);
    // Notes from my entry visible, other user's name visible in others group
    expect(text).toContain("did the thing");
    expect(text).toContain("Bob");
  });

  it("shows the anonymized count line when othersHiddenCount > 0", async () => {
    getTicketTimeEntriesMock.mockResolvedValue({
      ok: true,
      data: {
        data: makeSummary({
          totalMinutes: 60,
          othersTotalMinutes: 60,
          othersEntryCount: 2,
          othersHiddenMinutes: 60,
          othersHiddenCount: 2,
        }),
      },
    });

    const renderer = renderSection();
    await flushAsyncWork();

    const text = getTextContent(renderer).join(" ");
    expect(text).toContain("count=2");
    expect(text).toContain("duration=1 h");
  });

  it("shows an error message when the API call fails", async () => {
    getTicketTimeEntriesMock.mockResolvedValue({
      ok: false,
      error: { kind: "server" },
    });

    const renderer = renderSection();
    await flushAsyncWork();

    expect(getTextContent(renderer)).toContain("Unable to load time entries.");
  });

  it("re-fetches when refreshKey changes", async () => {
    let renderer: ReactTestRenderer | null = null;
    act(() => {
      renderer = create(
        React.createElement(TimeEntriesSection, {
          client: { request: vi.fn() } as any,
          apiKey: "api-key-1",
          ticketId: "ticket-1",
          refreshKey: 0,
        }),
      );
    });
    await flushAsyncWork();
    expect(getTicketTimeEntriesMock).toHaveBeenCalledTimes(1);

    act(() => {
      renderer!.update(
        React.createElement(TimeEntriesSection, {
          client: { request: vi.fn() } as any,
          apiKey: "api-key-1",
          ticketId: "ticket-1",
          refreshKey: 1,
        }),
      );
    });
    await flushAsyncWork();

    expect(getTicketTimeEntriesMock).toHaveBeenCalledTimes(2);
  });

  it("renders the add button only when onAddPress is provided and fires it on press", async () => {
    const onAddPress = vi.fn();
    const renderer = renderSection({ onAddPress });
    await flushAsyncWork();

    const addButton = renderer.root.findByProps({ accessibilityLabel: "Add time entry" });
    await act(async () => {
      addButton.props.onPress();
    });
    expect(onAddPress).toHaveBeenCalledTimes(1);
  });

  it("does not render the add button when onAddPress is omitted", async () => {
    const renderer = renderSection();
    await flushAsyncWork();
    const addButtons = renderer.root.findAllByProps({ accessibilityLabel: "Add time entry" });
    expect(addButtons).toHaveLength(0);
  });
});
