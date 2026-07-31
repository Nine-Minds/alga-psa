import React from "react";
import { TextInput } from "react-native";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared UI primitives rely on the automatic JSX runtime and don't import React;
// the vitest transform uses the classic runtime, so expose React globally.
Object.assign(globalThis, { React });

const { listInteractionTypesMock, createInteractionMock, translate } = vi.hoisted(() => ({
  listInteractionTypesMock: vi.fn(),
  createInteractionMock: vi.fn(),
  // Stable identity across renders (matches production react-i18next).
  translate: (_key: string, def?: string) => def ?? _key,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock("../../../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../../../ui/themes");
  return { useTheme: () => lightTheme };
});

vi.mock("../../../ui/toast/ToastProvider", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../../../api/interactions", () => ({
  listInteractionTypes: (...args: unknown[]) => listInteractionTypesMock(...args),
  createInteraction: (...args: unknown[]) => createInteractionMock(...args),
}));

vi.mock("../../../ui/components/Select", async () => {
  const React = await import("react");
  return {
    Select: (props: { options: Array<{ label: string; value: string }>; onSelect: (v: string) => void }) =>
      React.createElement(
        "SelectStub",
        {},
        (props.options ?? []).map((option) =>
          React.createElement(
            "Pressable",
            {
              key: String(option.value),
              testID: `select-option-${option.value}`,
              onPress: () => props.onSelect(option.value),
            },
            option.label,
          ),
        ),
      ),
  };
});

import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { LogInteractionModal } from "./LogInteractionModal";

type Props = Parameters<typeof LogInteractionModal>[0];

function makeProps(over: Partial<Props> = {}): Props {
  return {
    visible: true,
    client: { request: vi.fn() } as never,
    apiKey: "api-key",
    opportunityId: "opp-1",
    clientId: "client-1",
    contactNameId: "contact-1",
    onClose: vi.fn(),
    onLogged: vi.fn(),
    ...over,
  };
}

async function render(props: Props): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(LogInteractionModal, props));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

function inputByLabel(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const input = renderer.root.findAllByType(TextInput).find((n) => n.props.accessibilityLabel === label);
  if (!input) throw new Error(`TextInput "${label}" not found`);
  return input;
}

function pressOption(renderer: ReactTestRenderer, value: string) {
  const option = renderer.root.find((n) => n.props.testID === `select-option-${value}`);
  act(() => option.props.onPress());
}

function submitButton(renderer: ReactTestRenderer): ReactTestInstance {
  const button = renderer.root.findAllByType(PrimaryButton).find((b) => b.props.children === "Log it");
  if (!button) throw new Error("submit button not found");
  return button;
}

describe("LogInteractionModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listInteractionTypesMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: [
          { type_id: "type-call", type_name: "Call" },
          { type_id: "type-email", type_name: "Email" },
        ],
      },
    });
    createInteractionMock.mockResolvedValue({ ok: true, status: 200, data: { data: {} } });
  });

  it("keeps submit disabled until a type is chosen", async () => {
    const renderer = await render(makeProps());
    expect(submitButton(renderer).props.disabled).toBe(true);

    pressOption(renderer, "type-call");
    expect(submitButton(renderer).props.disabled).toBe(false);
  });

  it("posts the chosen type, deal context, and field values", async () => {
    const props = makeProps();
    const renderer = await render(props);

    pressOption(renderer, "type-call");
    act(() => inputByLabel(renderer, "Title").props.onChangeText("Intro call"));
    act(() => inputByLabel(renderer, "Notes").props.onChangeText("Talked pricing"));
    act(() => inputByLabel(renderer, "Duration (minutes)").props.onChangeText("30"));

    await act(async () => {
      submitButton(renderer).props.onPress();
    });

    expect(createInteractionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          type_id: "type-call",
          opportunity_id: "opp-1",
          client_id: "client-1",
          contact_name_id: "contact-1",
          title: "Intro call",
          notes: "Talked pricing",
          duration: 30,
        }),
      }),
    );
    expect(props.onLogged).toHaveBeenCalled();
  });

  it("preselects the Call type and duration when opened from a call prompt", async () => {
    const renderer = await render(makeProps({ preferTypeName: "Call", initialDuration: 4 }));

    // Call type preselected -> submit already enabled without user interaction.
    expect(submitButton(renderer).props.disabled).toBe(false);
    expect(inputByLabel(renderer, "Duration (minutes)").props.value).toBe("4");
  });
});
