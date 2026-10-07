import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const translate = (key: string) => key;
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("../../../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../../../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../../../ui/components/DatePickerField", () => ({
  DatePickerField: (props: Record<string, unknown>) => React.createElement("MockDatePicker", props),
}));
vi.mock("../../../ui/components/TimePickerField", () => ({
  TimePickerField: (props: Record<string, unknown>) => React.createElement("MockTimePicker", props),
}));
vi.mock("../../../ui/components/PrimaryButton", () => ({
  PrimaryButton: (props: Record<string, unknown>) => React.createElement("MockPrimaryButton", props, props.children as React.ReactNode),
}));

const getServices = vi.fn();
vi.mock("../../../api/timeEntries", () => ({ getServices: (...args: unknown[]) => getServices(...args) }));

import { TimeEntryModal } from "./TimeEntryModal";

async function render(props: Partial<React.ComponentProps<typeof TimeEntryModal>> = {}) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(TimeEntryModal, {
      visible: true,
      date: new Date("2026-05-05T00:00:00"),
      onChangeDate: vi.fn(),
      startTime: "10:00",
      onChangeStartTime: vi.fn(),
      endTime: "10:30",
      onChangeEndTime: vi.fn(),
      notes: "",
      onChangeNotes: vi.fn(),
      serviceId: "svc-1",
      onChangeServiceId: vi.fn(),
      client: { request: vi.fn() } as never,
      apiKey: "api-key",
      updating: false,
      error: null,
      onSubmit: vi.fn(),
      onClose: vi.fn(),
      ...props,
    }));
  });
  return renderer;
}

function sourceMark(renderer: ReactTestRenderer): string | null {
  const nodes = renderer.root.findAll((n) => n.props?.testID === "time-entry-service-source", { deep: true });
  if (nodes.length === 0) return null;
  return String(nodes[0].props.children);
}

describe("TimeEntryModal service provenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServices.mockResolvedValue({ ok: true, data: { data: [{ service_id: "svc-1", service_name: "Onsite" }] } });
  });

  it("marks the field with the level a prefilled service came from", async () => {
    expect(sourceMark(await render({ serviceSource: "phase" }))).toBe("timeEntry.serviceSource.phase");
    expect(sourceMark(await render({ serviceSource: "project" }))).toBe("timeEntry.serviceSource.project");
    expect(sourceMark(await render({ serviceSource: "task" }))).toBe("timeEntry.serviceSource.task");
  });

  it("shows no mark when the service was not prefilled", async () => {
    expect(sourceMark(await render())).toBeNull();
    expect(sourceMark(await render({ serviceSource: null }))).toBeNull();
  });
});
