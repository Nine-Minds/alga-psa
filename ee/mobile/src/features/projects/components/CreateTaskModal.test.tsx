import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  createProjectTask: vi.fn(),
  listPriorities: vi.fn(),
  warn: vi.fn(),
  translate: (key: string, def?: string) => def ?? key,
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.translate }) }));
vi.mock("../../../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../../../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../../../api/projects", () => ({ createProjectTask: (...a: unknown[]) => mocks.createProjectTask(...a) }));
vi.mock("../../../api/priorities", () => ({ listPriorities: (...a: unknown[]) => mocks.listPriorities(...a) }));
vi.mock("../../../device/clientMetadata", () => ({ getClientMetadataHeaders: async () => ({ "x-client": "m" }) }));
vi.mock("../../../logging/logger", () => ({ logger: { warn: mocks.warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("../../../ui/components/DatePickerField", () => ({
  DatePickerField: (p: Record<string, unknown>) => React.createElement("DatePickerField", p),
}));
vi.mock("../../../ui/components/TextInput", () => ({
  TextInput: (p: Record<string, unknown>) => React.createElement("UITextInput", p),
}));
vi.mock("../../../ui/components/EntityPickerModal", () => ({
  EntityPickerModal: (p: Record<string, unknown>) => React.createElement("EntityPickerModal", p),
}));
vi.mock("../../ticketDetail/components/AgentPickerModal", () => ({
  AgentPickerModal: (p: Record<string, unknown>) => React.createElement("AgentPickerModal", p),
}));

import { CreateTaskModal } from "./CreateTaskModal";

type Props = React.ComponentProps<typeof CreateTaskModal>;
const client = { request: vi.fn() } as never;

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function render(overrides: Partial<Props> = {}) {
  const props: Props = {
    visible: true,
    client,
    apiKey: "key",
    projectId: "p1",
    phaseId: "ph1",
    phaseName: "Phase One",
    statusMappingId: "m1",
    onClose: vi.fn(),
    onCreated: vi.fn(),
    onForbidden: vi.fn(),
    ...overrides,
  };
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<CreateTaskModal {...props} />);
  });
  await flush();
  return { r, props };
}

const byTestId = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => n.props.testID === id)[0];
const host = (r: ReactTestRenderer, type: string) => r.root.findAll((n) => (n.type as unknown) === type)[0];
const texts = (r: ReactTestRenderer) => r.root.findAllByType(Text).map((n) => String(n.props.children));

describe("CreateTaskModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listPriorities.mockResolvedValue({
      ok: true,
      data: { data: [{ priority_id: "pr-h", priority_name: "High" }] },
    });
    mocks.createProjectTask.mockResolvedValue({ ok: true, data: { data: { task_id: "new-task" } } });
  });

  it("loads project_task priorities and keeps save disabled until a name is entered", async () => {
    const { r } = await render();
    expect(mocks.listPriorities).toHaveBeenCalledWith(client, { apiKey: "key", itemType: "project_task" });
    expect(texts(r)).toEqual(expect.arrayContaining(["New task", "Phase One"]));
    expect(host(r, "EntityPickerModal").props.items).toEqual([{ id: "pr-h", label: "High" }]);
    expect(byTestId(r, "create-task-save").props.disabled).toBe(true);
    act(() => byTestId(r, "create-task-name").props.onChangeText("   "));
    expect(byTestId(r, "create-task-save").props.disabled).toBe(true);
    act(() => byTestId(r, "create-task-name").props.onChangeText("Rack servers"));
    expect(byTestId(r, "create-task-save").props.disabled).toBe(false);
  });

  it("submits all fields with hours converted to minutes and a day-only due date", async () => {
    const { r, props } = await render();
    act(() => {
      byTestId(r, "create-task-name").props.onChangeText("  Rack servers ");
      byTestId(r, "create-task-description").props.onChangeText(" Two racks ");
      byTestId(r, "create-task-estimated-hours").props.onChangeText("1.5");
      host(r, "DatePickerField").props.onChange(new Date(2026, 0, 5));
    });
    act(() => byTestId(r, "create-task-assignee").props.onPress());
    expect(host(r, "AgentPickerModal").props.visible).toBe(true);
    act(() => host(r, "AgentPickerModal").props.onSelect("u-9", "Nina"));
    expect(host(r, "AgentPickerModal").props.visible).toBe(false);
    expect(texts(r)).toContain("Nina");

    act(() => byTestId(r, "create-task-priority").props.onPress());
    expect(host(r, "EntityPickerModal").props.visible).toBe(true);
    act(() => host(r, "EntityPickerModal").props.onSelect("pr-h", "High"));
    expect(texts(r)).toContain("High");

    await act(async () => {
      byTestId(r, "create-task-save").props.onPress();
    });
    await flush();
    expect(mocks.createProjectTask).toHaveBeenCalledWith(client, {
      apiKey: "key",
      projectId: "p1",
      phaseId: "ph1",
      data: {
        task_name: "Rack servers",
        project_status_mapping_id: "m1",
        description: "Two racks",
        assigned_to: "u-9",
        due_date: "2026-01-05",
        priority_id: "pr-h",
        estimated_hours: 90,
      },
      auditHeaders: { "x-client": "m" },
    });
    expect(props.onCreated).toHaveBeenCalledWith({ task_id: "new-task" });
  });

  it("omits optional fields and ignores non-positive hours; unassign clears the assignee", async () => {
    const { r } = await render();
    act(() => {
      byTestId(r, "create-task-name").props.onChangeText("Minimal");
      byTestId(r, "create-task-estimated-hours").props.onChangeText("0");
    });
    act(() => host(r, "AgentPickerModal").props.onSelect("u-9", "Nina"));
    act(() => host(r, "AgentPickerModal").props.onUnassign());
    await act(async () => {
      byTestId(r, "create-task-save").props.onPress();
    });
    await flush();
    expect(mocks.createProjectTask.mock.calls[0][1].data).toEqual({ task_name: "Minimal", project_status_mapping_id: "m1" });
  });

  it("routes a permission error to onForbidden", async () => {
    mocks.createProjectTask.mockResolvedValue({ ok: false, error: { kind: "permission" } });
    const { r, props } = await render();
    act(() => byTestId(r, "create-task-name").props.onChangeText("X"));
    await act(async () => {
      byTestId(r, "create-task-save").props.onPress();
    });
    await flush();
    expect(props.onForbidden).toHaveBeenCalled();
    expect(props.onCreated).not.toHaveBeenCalled();
    expect(byTestId(r, "create-task-error")).toBeUndefined();
  });

  it("shows an inline error for other failures", async () => {
    mocks.createProjectTask.mockResolvedValue({ ok: false, error: { kind: "server" } });
    const { r, props } = await render();
    act(() => byTestId(r, "create-task-name").props.onChangeText("X"));
    await act(async () => {
      byTestId(r, "create-task-save").props.onPress();
    });
    await flush();
    expect(mocks.warn).toHaveBeenCalled();
    expect(byTestId(r, "create-task-error").props.children).toBe("Unable to create the task.");
    expect(props.onForbidden).not.toHaveBeenCalled();
  });

  it("blocks saving when the phase has no status mapping", async () => {
    const { r } = await render({ statusMappingId: null, phaseName: null });
    act(() => byTestId(r, "create-task-name").props.onChangeText("X"));
    expect(byTestId(r, "create-task-save").props.disabled).toBe(true);
    expect(texts(r)).toContain("This project has no task statuses yet. Add one on the web.");
    expect(texts(r)).not.toContain("Phase One");
  });

  it("does not load priorities without a client, and the close button calls onClose", async () => {
    const { r, props } = await render({ client: null });
    expect(mocks.listPriorities).not.toHaveBeenCalled();
    act(() => byTestId(r, "create-task-close").props.onPress());
    expect(props.onClose).toHaveBeenCalled();
    await act(async () => {
      byTestId(r, "create-task-save").props.onPress();
    });
    expect(mocks.createProjectTask).not.toHaveBeenCalled();
  });

  it("resets the form when reopened", async () => {
    const { r, props } = await render();
    act(() => byTestId(r, "create-task-name").props.onChangeText("Draft"));
    await act(async () => r.update(<CreateTaskModal {...props} visible={false} />));
    await act(async () => r.update(<CreateTaskModal {...props} visible />));
    expect(byTestId(r, "create-task-name").props.value).toBe("");
  });
});
