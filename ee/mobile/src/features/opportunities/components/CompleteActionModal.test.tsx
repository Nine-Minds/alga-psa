import React from "react";
import { TextInput } from "react-native";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared UI primitives rely on the automatic JSX runtime and don't import React;
// the vitest transform uses the classic runtime, so expose React globally.
Object.assign(globalThis, { React });

const { completeNextActionMock, datePickerProps, timePickerProps, translate } = vi.hoisted(() => ({
  completeNextActionMock: vi.fn(),
  datePickerProps: [] as Array<Record<string, unknown>>,
  timePickerProps: [] as Array<Record<string, unknown>>,
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

vi.mock("../../../api/opportunities", () => ({
  completeNextAction: (...args: unknown[]) => completeNextActionMock(...args),
}));

vi.mock("../../../ui/components/DatePickerField", () => ({
  DatePickerField: (props: Record<string, unknown>) => {
    datePickerProps.push(props);
    return null;
  },
}));

vi.mock("../../../ui/components/TimePickerField", () => ({
  TimePickerField: (props: Record<string, unknown>) => {
    timePickerProps.push(props);
    return null;
  },
}));

import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { CompleteActionModal } from "./CompleteActionModal";

type Props = Parameters<typeof CompleteActionModal>[0];

function makeProps(over: Partial<Props> = {}): Props {
  return {
    visible: true,
    currentAction: "Send the proposal",
    client: { request: vi.fn() } as never,
    apiKey: "api-key",
    opportunityId: "opp-1",
    onClose: vi.fn(),
    onCompleted: vi.fn(),
    ...over,
  };
}

function render(props: Props): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(React.createElement(CompleteActionModal, props));
  });
  return renderer;
}

function submitButton(renderer: ReactTestRenderer): ReactTestInstance {
  const button = renderer.root.findAllByType(PrimaryButton).find((b) => b.props.children === "Complete and set next");
  if (!button) throw new Error("submit button not found");
  return button;
}

describe("CompleteActionModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    datePickerProps.length = 0;
    timePickerProps.length = 0;
    completeNextActionMock.mockResolvedValue({ ok: true, status: 200, data: { data: {} } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps submit disabled until both a successor action and due date/time are set", async () => {
    const renderer = render(makeProps());

    expect(submitButton(renderer).props.disabled).toBe(true);

    // Successor action only -> still disabled (no due).
    act(() => renderer.root.findByType(TextInput).props.onChangeText("Book the kickoff"));
    expect(submitButton(renderer).props.disabled).toBe(true);

    // Add a date but no time -> still disabled.
    act(() => (datePickerProps[datePickerProps.length - 1].onChange as (d: Date) => void)(new Date(2026, 6, 20)));
    expect(submitButton(renderer).props.disabled).toBe(true);

    // Add the time -> enabled.
    act(() => (timePickerProps[timePickerProps.length - 1].onChange as (v: string) => void)("09:00"));
    expect(submitButton(renderer).props.disabled).toBe(false);
  });

  it("submits the trimmed successor action and combined ISO due date", async () => {
    const props = makeProps();
    const renderer = render(props);

    act(() => renderer.root.findByType(TextInput).props.onChangeText("  Book the kickoff  "));
    act(() => (datePickerProps[datePickerProps.length - 1].onChange as (d: Date) => void)(new Date(2026, 6, 20)));
    act(() => (timePickerProps[timePickerProps.length - 1].onChange as (v: string) => void)("09:00"));

    await act(async () => {
      submitButton(renderer).props.onPress();
    });

    expect(completeNextActionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        opportunityId: "opp-1",
        data: {
          next_action: "Book the kickoff",
          next_action_due: new Date(2026, 6, 20, 9, 0, 0).toISOString(),
        },
      }),
    );
    expect(props.onCompleted).toHaveBeenCalled();
  });
});
