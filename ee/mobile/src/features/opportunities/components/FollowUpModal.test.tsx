import React from "react";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared UI primitives rely on the automatic JSX runtime and don't import React;
// the vitest transform uses the classic runtime, so expose React globally.
Object.assign(globalThis, { React });

const { createScheduleEntryMock, translate } = vi.hoisted(() => ({
  createScheduleEntryMock: vi.fn(),
  // Stable identity across renders (matches production react-i18next).
  translate: (_key: string, def?: string, opts?: Record<string, unknown>) => {
    let out = def ?? _key;
    if (opts) {
      for (const [key, value] of Object.entries(opts)) {
        out = out.replaceAll(`{{${key}}}`, String(value));
      }
    }
    return out;
  },
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

vi.mock("../../../api/schedule", () => ({
  createScheduleEntry: (...args: unknown[]) => createScheduleEntryMock(...args),
}));

vi.mock("../../../ui/components/DatePickerField", () => ({
  DatePickerField: () => null,
}));

vi.mock("../../../ui/components/TimePickerField", () => ({
  TimePickerField: () => null,
}));

import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { FollowUpModal } from "./FollowUpModal";

type Props = Parameters<typeof FollowUpModal>[0];

function makeProps(over: Partial<Props> = {}): Props {
  return {
    visible: true,
    client: { request: vi.fn() } as never,
    apiKey: "api-key",
    userId: "user-1",
    dealTitle: "Acme renewal",
    onClose: vi.fn(),
    onScheduled: vi.fn(),
    ...over,
  };
}

async function render(props: Props): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(FollowUpModal, props));
  });
  return renderer;
}

function submitButton(renderer: ReactTestRenderer): ReactTestInstance {
  const button = renderer.root.findAllByType(PrimaryButton).find((b) => b.props.children === "Add to calendar");
  if (!button) throw new Error("submit button not found");
  return button;
}

describe("FollowUpModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 16, 8, 0, 0));
    createScheduleEntryMock.mockResolvedValue({ ok: true, status: 200, data: { data: {} } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("posts a schedule entry assigned to self, with no work_item_type", async () => {
    const props = makeProps();
    const renderer = await render(props);

    // Prefilled title + default times make the form immediately submittable.
    expect(submitButton(renderer).props.disabled).toBe(false);

    await act(async () => {
      submitButton(renderer).props.onPress();
    });

    expect(createScheduleEntryMock).toHaveBeenCalledTimes(1);
    const entry = createScheduleEntryMock.mock.calls[0][1].entry;
    expect(entry).not.toHaveProperty("work_item_type");
    expect(entry.assigned_user_ids).toEqual(["user-1"]);
    expect(entry.title).toBe("Follow up: Acme renewal");
    expect(typeof entry.scheduled_start).toBe("string");
    expect(typeof entry.scheduled_end).toBe("string");
    expect(props.onScheduled).toHaveBeenCalled();
  });
});
