import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { promptState, dismissMock, translate } = vi.hoisted(() => ({
  promptState: { prompt: null as Record<string, unknown> | null },
  dismissMock: vi.fn(),
  translate: (_key: string, def?: string, opts?: Record<string, unknown>) => {
    let out = def ?? _key;
    for (const [key, value] of Object.entries(opts ?? {})) out = out.replaceAll(`{{${key}}}`, String(value));
    return out;
  },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("../../../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../../../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../hooks/usePendingCallPrompt", () => ({
  usePendingCallPrompt: () => ({ prompt: promptState.prompt, dismiss: dismissMock }),
}));
vi.mock("../../opportunities/components/LogInteractionModal", () => ({
  LogInteractionModal: (props: Record<string, unknown>) => React.createElement("MockLogInteractionModal", props),
}));

import { CallPromptHost } from "./CallPromptHost";

const PROMPT = {
  phone: "+15550100",
  name: "Jane Doe",
  contactId: "contact-1",
  clientId: "client-1",
  ticketId: "ticket-1",
  opportunityId: null,
  durationMinutes: 7,
};

function render(onLogged = vi.fn()): { renderer: ReactTestRenderer; onLogged: ReturnType<typeof vi.fn> } {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      React.createElement(CallPromptHost, {
        origin: { kind: "ticket", id: "ticket-1" },
        client: { request: vi.fn() } as never,
        apiKey: "key",
        userId: "user-1",
        onLogged,
      }),
    );
  });
  return { renderer, onLogged };
}

const texts = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType(Text).map((n) => (Array.isArray(n.props.children) ? n.props.children.join("") : String(n.props.children)));
const modal = (renderer: ReactTestRenderer) => renderer.root.find((n) => String(n.type) === "MockLogInteractionModal");
const byTestId = (renderer: ReactTestRenderer, testID: string) => renderer.root.find((n) => n.props?.testID === testID);

describe("CallPromptHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    promptState.prompt = null;
  });

  it("renders nothing visible while no call is pending", () => {
    const { renderer } = render();
    expect(renderer.root.findAll((n) => n.props?.testID === "call-prompt")).toHaveLength(0);
    expect(modal(renderer).props.visible).toBe(false);
  });

  it("asks to log the call by the callee's name and dismisses on 'Not now'", () => {
    promptState.prompt = PROMPT;
    const { renderer } = render();

    expect(texts(renderer)).toContain("You called Jane Doe. Log it as an interaction?");
    act(() => byTestId(renderer, "call-prompt-dismiss").props.onPress());
    expect(dismissMock).toHaveBeenCalledOnce();
    expect(modal(renderer).props.visible).toBe(false);
  });

  it("falls back to the number when the callee has no name", () => {
    promptState.prompt = { ...PROMPT, name: null };
    const { renderer } = render();
    expect(texts(renderer)).toContain("You called +15550100. Log it as an interaction?");
  });

  it("opens the log dialog preset to a Call of the elapsed duration against whoever was called", () => {
    promptState.prompt = PROMPT;
    const { renderer, onLogged } = render();

    act(() => byTestId(renderer, "call-prompt-log").props.onPress());

    expect(dismissMock).toHaveBeenCalledOnce();
    const props = modal(renderer).props;
    expect(props).toMatchObject({
      visible: true,
      apiKey: "key",
      userId: "user-1",
      preferTypeName: "Call",
      initialDuration: 7,
      contactNameId: "contact-1",
      clientId: "client-1",
      ticketId: "ticket-1",
      opportunityId: undefined,
    });

    act(() => props.onLogged());
    expect(onLogged).toHaveBeenCalledOnce();
    act(() => props.onClose());
    expect(modal(renderer).props.visible).toBe(false);
  });
});
