import React from "react";
import { TextInput } from "react-native";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared UI primitives rely on the automatic JSX runtime and don't import React;
// the vitest transform uses the classic runtime, so expose React globally.
Object.assign(globalThis, { React });

const { loseOpportunityMock, translate } = vi.hoisted(() => ({
  loseOpportunityMock: vi.fn(),
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
  loseOpportunity: (...args: unknown[]) => loseOpportunityMock(...args),
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
import { LoseOpportunityModal } from "./LoseOpportunityModal";

type Props = Parameters<typeof LoseOpportunityModal>[0];

function makeProps(over: Partial<Props> = {}): Props {
  return {
    visible: true,
    client: { request: vi.fn() } as never,
    apiKey: "api-key",
    opportunityId: "opp-1",
    onClose: vi.fn(),
    onLost: vi.fn(),
    ...over,
  };
}

function render(props: Props): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(React.createElement(LoseOpportunityModal, props));
  });
  return renderer;
}

function lostToInput(renderer: ReactTestRenderer): ReactTestInstance | undefined {
  return renderer.root.findAllByType(TextInput).find((n) => n.props.accessibilityLabel === "Lost to");
}

function pressOption(renderer: ReactTestRenderer, value: string) {
  const option = renderer.root.find((n) => n.props.testID === `select-option-${value}`);
  act(() => option.props.onPress());
}

function submitButton(renderer: ReactTestRenderer): ReactTestInstance {
  const button = renderer.root.findAllByType(PrimaryButton).find((b) => b.props.children === "Mark lost");
  if (!button) throw new Error("submit button not found");
  return button;
}

describe("LoseOpportunityModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loseOpportunityMock.mockResolvedValue({ ok: true, status: 200, data: { data: {} } });
  });

  it("requires a reason before submitting", () => {
    const renderer = render(makeProps());
    expect(submitButton(renderer).props.disabled).toBe(true);

    pressOption(renderer, "price");
    expect(submitButton(renderer).props.disabled).toBe(false);
  });

  it("shows the lost-to field only for the chose_competitor reason", () => {
    const renderer = render(makeProps());
    expect(lostToInput(renderer)).toBeUndefined();

    pressOption(renderer, "chose_competitor");
    expect(lostToInput(renderer)).toBeDefined();

    pressOption(renderer, "price");
    expect(lostToInput(renderer)).toBeUndefined();
  });

  it("submits the reason and competitor name", async () => {
    const props = makeProps();
    const renderer = render(props);

    pressOption(renderer, "chose_competitor");
    act(() => lostToInput(renderer)!.props.onChangeText("Rival Corp"));

    await act(async () => {
      submitButton(renderer).props.onPress();
    });

    expect(loseOpportunityMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        opportunityId: "opp-1",
        data: expect.objectContaining({ loss_reason: "chose_competitor", lost_to: "Rival Corp" }),
      }),
    );
    expect(props.onLost).toHaveBeenCalled();
  });
});
