import React from "react";
import { Pressable, Text, TextInput } from "react-native";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveTimeSession } from "../../../api/timeTracking";

const { getServicesMock, datePickerProps, timePickerProps } = vi.hoisted(() => ({
  getServicesMock: vi.fn(),
  datePickerProps: [] as Array<Record<string, unknown>>,
  timePickerProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../ui/ThemeContext", () => ({
  useTheme: () => ({
    colors: {
      background: "#fff",
      text: "#000",
      textSecondary: "#999",
      textInverse: "#fff",
      primary: "#00f",
      border: "#ccc",
      card: "#fafafa",
      danger: "#f00",
      placeholder: "#aaa",
    },
    spacing: { xs: 2, sm: 4, md: 8, lg: 16, xl: 24 },
    typography: {
      title: { fontSize: 18 },
      body: { fontSize: 14 },
      caption: { fontSize: 12 },
    },
  }),
}));

vi.mock("../../../api/timeEntries", () => ({
  getServices: (...args: unknown[]) => getServicesMock(...args),
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
import { StopTimerModal } from "./StopTimerModal";

const NOW = new Date(2026, 6, 2, 12, 0, 0);
const START = new Date(2026, 6, 2, 11, 30, 0);

function makeSession(over: Partial<ActiveTimeSession> = {}): ActiveTimeSession {
  return {
    session_id: "session-1",
    work_item_id: "ticket-1",
    work_item_type: "ticket",
    start_time: START.toISOString(),
    notes: null,
    service_id: "svc-1",
    user_id: "user-1",
    elapsed_minutes: 30,
    work_item_title: "Printer down",
    service_name: "Remote Support",
    ...over,
  };
}

type ModalProps = Parameters<typeof StopTimerModal>[0];

function makeProps(over: Partial<ModalProps> = {}): ModalProps {
  return {
    visible: true,
    session: makeSession(),
    offsetMs: 0,
    client: { request: vi.fn() } as never,
    apiKey: "api-key",
    submitting: false,
    error: null,
    willStartNext: false,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    ...over,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderModal(props: ModalProps): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(React.createElement(StopTimerModal, props));
  });
  await flush();
  if (!renderer) throw new Error("Renderer was not created");
  return renderer;
}

function getTextContent(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => {
    const value = node.props.children;
    return Array.isArray(value) ? value.join("") : String(value);
  });
}

function findButton(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const button = renderer.root
    .findAllByType(PrimaryButton)
    .find((b) => b.props.children === label);
  if (!button) throw new Error(`PrimaryButton "${label}" not found`);
  return button;
}

function pressByAccessibilityLabel(renderer: ReactTestRenderer, label: string) {
  const target = renderer.root
    .findAllByType(Pressable)
    .find((p) => p.props.accessibilityLabel === label);
  if (!target) throw new Error(`Pressable "${label}" not found`);
  act(() => target.props.onPress());
}

async function openAdjustEnd(renderer: ReactTestRenderer) {
  pressByAccessibilityLabel(renderer, "timer.stopModal.adjustEnd");
  await flush();
}

function setEndTime(value: string) {
  const picker = timePickerProps[timePickerProps.length - 1];
  if (!picker) throw new Error("TimePickerField not rendered");
  act(() => (picker.onChange as (v: string) => void)(value));
}

function pressSave(renderer: ReactTestRenderer) {
  act(() => findButton(renderer, "timer.stopModal.save").props.onPress());
}

describe("StopTimerModal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    datePickerProps.length = 0;
    timePickerProps.length = 0;
    getServicesMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: [
          { service_id: "svc-1", service_name: "Remote Support" },
          { service_id: "svc-2", service_name: "On-site" },
        ],
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("submits without an end_time when the end was not adjusted", async () => {
    const props = makeProps();
    const renderer = await renderModal(props);

    pressSave(renderer);

    expect(props.onSubmit).toHaveBeenCalledWith({
      end_time: undefined,
      notes: undefined,
      service_id: "svc-1",
      is_billable: true,
    });
  });

  it("submits trimmed notes, the picked service, and the billable toggle", async () => {
    const props = makeProps();
    const renderer = await renderModal(props);

    const notes = renderer.root.findByType(TextInput);
    act(() => notes.props.onChangeText("  rebooted the print server  "));
    pressByAccessibilityLabel(renderer, "timer.stopModal.billableLabel");
    pressSave(renderer);

    expect(props.onSubmit).toHaveBeenCalledWith({
      end_time: undefined,
      notes: "rebooted the print server",
      service_id: "svc-1",
      is_billable: false,
    });
  });

  it("disables saving when the session has no service", async () => {
    const props = makeProps({ session: makeSession({ service_id: null, service_name: null }) });
    const renderer = await renderModal(props);

    expect(findButton(renderer, "timer.stopModal.save").props.disabled).toBe(true);
  });

  it("rejects an unparseable adjusted end time", async () => {
    const props = makeProps();
    const renderer = await renderModal(props);

    await openAdjustEnd(renderer);
    setEndTime("9:9");
    pressSave(renderer);

    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(getTextContent(renderer)).toContain("timer.stopModal.errors.invalidEnd");
  });

  it("rejects an end time at or before the timer start", async () => {
    const props = makeProps();
    const renderer = await renderModal(props);

    await openAdjustEnd(renderer);
    setEndTime("11:00");
    pressSave(renderer);

    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(getTextContent(renderer)).toContain("timer.stopModal.errors.endBeforeStart");
  });

  it("allows an end time up to 15 minutes ahead but no further", async () => {
    const props = makeProps();
    const renderer = await renderModal(props);
    await openAdjustEnd(renderer);

    setEndTime("12:16");
    pressSave(renderer);
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(getTextContent(renderer)).toContain("timer.stopModal.errors.endInFuture");

    setEndTime("12:15");
    pressSave(renderer);
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ end_time: new Date(2026, 6, 2, 12, 15, 0).toISOString() }),
    );
  });

  it("submits the adjusted end as an ISO timestamp", async () => {
    const props = makeProps();
    const renderer = await renderModal(props);

    await openAdjustEnd(renderer);
    setEndTime("11:45");
    pressSave(renderer);

    expect(props.onSubmit).toHaveBeenCalledWith({
      end_time: new Date(2026, 6, 2, 11, 45, 0).toISOString(),
      notes: undefined,
      service_id: "svc-1",
      is_billable: true,
    });
  });

  it("maps the adjusted end into server time when the clocks are offset", async () => {
    // Server is 10 minutes ahead: a timer started at server 11:30 began at
    // local 11:20, so a local 11:25 end is valid even though it is "before"
    // the server start timestamp.
    const props = makeProps({ offsetMs: 10 * 60_000 });
    const renderer = await renderModal(props);

    await openAdjustEnd(renderer);
    setEndTime("11:25");
    pressSave(renderer);

    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ end_time: new Date(2026, 6, 2, 11, 25, 0).toISOString() }),
    );
  });

  it("resets the form each time it opens", async () => {
    const props = makeProps({ session: makeSession({ notes: "from server" }) });
    const renderer = await renderModal(props);

    const notes = renderer.root.findByType(TextInput);
    act(() => notes.props.onChangeText("scratch edits"));
    expect(renderer.root.findByType(TextInput).props.value).toBe("scratch edits");

    act(() => {
      renderer.update(React.createElement(StopTimerModal, { ...props, visible: false }));
    });
    act(() => {
      renderer.update(React.createElement(StopTimerModal, { ...props, visible: true }));
    });
    await flush();

    expect(renderer.root.findByType(TextInput).props.value).toBe("from server");
  });

  it("keeps running via onClose and never submits", async () => {
    const props = makeProps();
    const renderer = await renderModal(props);

    act(() => findButton(renderer, "timer.stopModal.keepRunning").props.onPress());

    expect(props.onClose).toHaveBeenCalled();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});
