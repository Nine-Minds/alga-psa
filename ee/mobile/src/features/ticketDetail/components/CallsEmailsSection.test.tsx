import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listInteractionsMock = vi.fn();
const translate = (key: string) => key;
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("../../../api/interactions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/interactions")>()),
  listInteractions: (...args: unknown[]) => listInteractionsMock(...args),
}));
vi.mock("../../../ui/formatters/dateTime", () => ({ formatDateShort: (iso: string) => `d(${iso})`, formatDateTimeWithRelative: (iso: string) => `dt(${iso})` }));
vi.mock("../../../ui/components/BottomSheet", () => ({
  BottomSheet: (props: Record<string, unknown>) => (props.visible ? React.createElement("MockBottomSheet", props, props.children as React.ReactNode) : null),
}));
vi.mock("../../../ui/components/Card", () => ({
  Card: (props: Record<string, unknown>) => React.createElement("MockCard", props, props.children as React.ReactNode),
}));
vi.mock("../../../ui/components/SectionHeader", () => ({
  SectionHeader: (props: Record<string, unknown>) => React.createElement("MockSectionHeader", props, props.action as React.ReactNode),
}));
vi.mock("../../../ui/components/Badge", () => ({
  Badge: (props: Record<string, unknown>) => React.createElement("MockBadge", props),
}));
vi.mock("../../../ui/components/PrimaryButton", () => ({
  PrimaryButton: (props: Record<string, unknown>) => React.createElement("MockPrimaryButton", props, props.children as React.ReactNode),
}));
vi.mock("../../opportunities/components/LogInteractionModal", () => ({
  LogInteractionModal: (props: Record<string, unknown>) => (props.visible ? React.createElement("MockLogInteractionModal", props) : null),
}));

import { CallsEmailsSection } from "./CallsEmailsSection";

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function render(props: Partial<React.ComponentProps<typeof CallsEmailsSection>> = {}) {
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(React.createElement(CallsEmailsSection, {
      client: { request: vi.fn() } as never,
      apiKey: "key",
      userId: "user-1",
      ticketId: "ticket-1",
      clientId: "client-1",
      contactNameId: "contact-1",
      ...props,
    }));
  });
  return renderer as unknown as ReactTestRenderer;
}

const texts = (renderer: ReactTestRenderer) => renderer.root.findAllByType(Text).map((n) => {
  const c = n.props.children;
  return Array.isArray(c) ? c.join("") : String(c);
});

describe("CallsEmailsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listInteractionsMock.mockResolvedValue({ ok: true, data: { data: [], pagination: { total: 0 } } });
  });

  it("lists the ticket's recent interactions with type, author, and date", async () => {
    listInteractionsMock.mockResolvedValue({
      ok: true,
      data: {
        data: [
          { interaction_id: "i-1", type_id: "t", type_name: "Call", title: "Called about the outage", user_name: "Sam", interaction_date: "2026-09-11T10:00:00.000Z" },
          { interaction_id: "i-2", type_id: "t", type_name: "Email", title: null, user_name: "Sam", interaction_date: "2026-09-10T10:00:00.000Z" },
        ],
        pagination: { total: 7 },
      },
    });

    const renderer = render();
    await flush();

    expect(listInteractionsMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ticketId: "ticket-1", limit: 5 }));
    expect(renderer.root.findByProps({ testID: "calls-emails-row-i-1" }).props.children).toBe("Called about the outage");
    expect(renderer.root.findByProps({ testID: "calls-emails-row-i-2" }).props.children).toBe("Email");
    expect(texts(renderer)).toContain("Call • Sam • d(2026-09-11T10:00:00.000Z)");
    expect(renderer.root.findByType("MockBadge" as never).props.label).toBe("7");
  });

  it("shows the empty state and opens the log dialog scoped to the ticket", async () => {
    const renderer = render();
    await flush();
    expect(texts(renderer)).toContain("callsEmails.empty");
    expect(renderer.root.findAllByType("MockLogInteractionModal" as never)).toHaveLength(0);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "callsEmails.logInteraction" }).props.onPress();
    });
    const modal = renderer.root.findByType("MockLogInteractionModal" as never);
    expect(modal.props).toMatchObject({ ticketId: "ticket-1", clientId: "client-1", contactNameId: "contact-1", userId: "user-1" });
  });

  it("reloads the list and notifies the parent after an interaction is logged", async () => {
    const onLogged = vi.fn();
    const renderer = render({ onLogged });
    await flush();
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "callsEmails.logInteraction" }).props.onPress();
    });
    await act(async () => {
      renderer.root.findByType("MockLogInteractionModal" as never).props.onLogged();
    });
    await flush();

    expect(listInteractionsMock).toHaveBeenCalledTimes(2);
    expect(onLogged).toHaveBeenCalledTimes(1);
  });

  it("shows a load error with retry", async () => {
    listInteractionsMock
      .mockResolvedValueOnce({ ok: false, error: { kind: "network", message: "offline" } })
      .mockResolvedValueOnce({ ok: true, data: { data: [], pagination: { total: 0 } } });
    const renderer = render();
    await flush();
    expect(texts(renderer)).toContain("callsEmails.errors.load");

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "common:retry" }).props.onPress();
    });
    await flush();
    expect(texts(renderer)).toContain("callsEmails.empty");
  });

  it("opens a detail sheet with the interaction's notes and scheduled time when a row is tapped", async () => {
    listInteractionsMock.mockResolvedValue({
      ok: true,
      data: {
        data: [{ interaction_id: "i-1", type_id: "t", type_name: "Call", title: "Follow up call", notes: "Ask about the backup", user_name: "Sam", interaction_date: "2026-09-11T10:00:00.000Z", start_time: "2026-09-12T09:00:00.000Z", duration: 30 }],
        pagination: { total: 1 },
      },
    });
    const renderer = render();
    await flush();
    expect(renderer.root.findAllByType("MockBottomSheet" as never)).toHaveLength(0);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "Follow up call. Call • Sam • d(2026-09-12T09:00:00.000Z)" }).props.onPress();
    });

    const sheet = renderer.root.findByType("MockBottomSheet" as never);
    expect(sheet.props.title).toBe("Follow up call");
    const detailTexts = texts(renderer);
    expect(detailTexts).toContain("Ask about the backup");
    expect(detailTexts).toContain("dt(2026-09-12T09:00:00.000Z)");
    expect(detailTexts).toContain("callsEmails.detail.scheduledFor");
  });
});
