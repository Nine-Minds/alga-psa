import React from "react";
import { Linking, Pressable, Text, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  getDetails: vi.fn(),
  refreshSession: () => undefined,
  claim: vi.fn(),
  unclaim: vi.fn(),
  complete: vi.fn(),
  session: { accessToken: "api-key", tenantId: "tenant-1", user: { id: "me" } } as unknown,
  config: { ok: true, env: "dev", baseUrl: "https://algapsa.com" } as unknown,
  translate: (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string | undefined) ?? key,
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.translate }) }));
vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ session: mocks.session, refreshSession: mocks.refreshSession }) }));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => mocks.config }));
vi.mock("../api", () => ({ createApiClient: () => ({ request: vi.fn() }) }));
vi.mock("../api/workflowTasks", () => ({
  getWorkflowTaskDetails: (...a: unknown[]) => mocks.getDetails(...a),
  claimWorkflowTask: (...a: unknown[]) => mocks.claim(...a),
  unclaimWorkflowTask: (...a: unknown[]) => mocks.unclaim(...a),
  completeWorkflowTask: (...a: unknown[]) => mocks.complete(...a),
}));
vi.mock("../ui/formatters/dateTime", () => ({ formatDateShort: (v: string) => `D(${v})` }));

import { WorkflowTaskDetailScreen } from "./WorkflowTaskDetailScreen";

const simpleSchema = {
  jsonSchema: {
    type: "object",
    required: ["approved", "reason", "amount"],
    properties: {
      approved: { type: "boolean", title: "Approved" },
      reason: { type: "string", title: "Reason" },
      amount: { type: "number", title: "Amount" },
      level: { enum: ["low", "high"], enumNames: ["Low", "High"], title: "Level", default: "low" },
    },
  },
  defaultValues: { reason: "prefilled" },
};

function task(extra: Record<string, unknown> = {}) {
  return { taskId: "wt-1", title: "Approve purchase", status: "pending", ...extra };
}
const ok = (data: unknown) => ({ ok: true, data: { data } });

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<WorkflowTaskDetailScreen {...({ route: { params: { taskId: "wt-1" } }, navigation: {} } as unknown as React.ComponentProps<typeof WorkflowTaskDetailScreen>)} />);
  });
  await flush();
  return r;
}

const texts = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map((n) => {
    const v = n.props.children;
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").join("") : String(v);
  });
const button = (r: ReactTestRenderer, label: string) =>
  r.root.findAll((n) => n.type === Pressable && n.props.accessibilityLabel === label)[0];
const input = (r: ReactTestRenderer, label: string) =>
  r.root.findAll((n) => n.type === TextInput && n.props.accessibilityLabel === label)[0];

describe("WorkflowTaskDetailScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { accessToken: "api-key", tenantId: "tenant-1", user: { id: "me" } };
    mocks.config = { ok: true, env: "dev", baseUrl: "https://algapsa.com" };
    mocks.getDetails.mockResolvedValue(ok(task()));
    mocks.claim.mockResolvedValue(ok({ success: true }));
    mocks.unclaim.mockResolvedValue(ok({ success: true }));
    mocks.complete.mockResolvedValue(ok({ success: true }));
  });

  it("shows config and signed-out errors without calling the API", async () => {
    mocks.config = { ok: false, error: "bad config" };
    let r = await render();
    expect(texts(r)).toEqual(expect.arrayContaining(["common:configurationError", "bad config"]));
    mocks.config = { ok: true, baseUrl: "https://x" };
    mocks.session = null;
    r = await render();
    expect(texts(r)).toContain("common:signedOut");
    expect(mocks.getDetails).not.toHaveBeenCalled();
  });

  it("shows a load error with retry", async () => {
    mocks.getDetails.mockResolvedValueOnce({ ok: false, error: { kind: "network" } });
    const r = await render();
    expect(mocks.getDetails).toHaveBeenCalledWith(expect.anything(), { apiKey: "api-key", taskId: "wt-1" });
    expect(texts(r)).toContain("Unable to load this task.");
    const retry = r.root.findAll((n) => n.type === Pressable && n.props.accessibilityRole === "button")[0];
    await act(async () => retry.props.onPress());
    await flush();
    expect(texts(r)).toContain("Approve purchase");
  });

  it("renders task details: status, priority, due date, roles, description fallback", async () => {
    mocks.getDetails.mockResolvedValue(
      ok(task({ status: "completed", priority: "High", dueDate: "2026-12-01", assignedRoles: ["Admin", "Tech"] })),
    );
    const r = await render();
    const all = texts(r);
    expect(all).toEqual(expect.arrayContaining(["Approve purchase", "completed", "High", "D(2026-12-01)", "Admin, Tech", "No description."]));
    expect(button(r, "Claim task")).toBeUndefined();
    expect(all).not.toContain("Finish in the web app");
  });

  it("claims a pending pool task and re-fetches", async () => {
    mocks.getDetails
      .mockResolvedValueOnce(ok(task({ formSchema: simpleSchema })))
      .mockResolvedValueOnce(ok(task({ status: "claimed", claimedBy: "me", formSchema: simpleSchema })));
    const r = await render();
    expect(texts(r)).toContain("Claim this task before completing it.");
    await act(async () => button(r, "Claim task").props.onPress());
    await flush();
    expect(mocks.claim).toHaveBeenCalledWith(expect.anything(), { apiKey: "api-key", taskId: "wt-1" });
    expect(mocks.getDetails).toHaveBeenCalledTimes(2);
    expect(button(r, "Release task")).toBeDefined();
    expect(button(r, "Claim task")).toBeUndefined();
  });

  it("shows permission and validation messages when claim fails", async () => {
    mocks.claim.mockResolvedValueOnce({ ok: false, error: { kind: "permission" } });
    mocks.getDetails.mockResolvedValue(ok(task({ formSchema: simpleSchema })));
    const r = await render();
    await act(async () => button(r, "Claim task").props.onPress());
    expect(texts(r)).toContain("You don't have permission to do that.");

    mocks.claim.mockResolvedValueOnce({ ok: false, error: { kind: "validation", message: "Already claimed" } });
    await act(async () => button(r, "Claim task").props.onPress());
    expect(texts(r)).toContain("Already claimed");

    mocks.claim.mockResolvedValueOnce({ ok: false, error: { kind: "validation", message: "HTTP 400" } });
    await act(async () => button(r, "Claim task").props.onPress());
    expect(texts(r)).toContain("Unable to claim this task.");
  });

  it("releases a task I claimed, and reports release failures", async () => {
    mocks.getDetails.mockResolvedValue(ok(task({ status: "claimed", claimedBy: "me" })));
    const r = await render();
    mocks.unclaim.mockResolvedValueOnce({ ok: false, error: { kind: "server" } });
    await act(async () => button(r, "Release task").props.onPress());
    expect(texts(r)).toContain("Unable to update this task.");
    await act(async () => button(r, "Release task").props.onPress());
    await flush();
    expect(mocks.unclaim).toHaveBeenCalledTimes(2);
    expect(mocks.getDetails).toHaveBeenCalledTimes(2);
  });

  it("completes a simple form for a directly-assigned task once required fields are filled", async () => {
    mocks.getDetails.mockResolvedValue(ok(task({ assignedUsers: ["me"], formSchema: simpleSchema })));
    const r = await render();
    expect(button(r, "Claim task")).toBeUndefined();
    expect(texts(r)).toContain("Complete task");
    expect(input(r, "Reason").props.value).toBe("prefilled");
    expect(button(r, "Submit").props.disabled).toBe(true);

    act(() => button(r, "Approved").props.onPress());
    expect(button(r, "Approved").props.accessibilityState).toEqual({ checked: true });
    act(() => input(r, "Amount").props.onChangeText("12.5"));
    expect(input(r, "Amount").props.value).toBe("12.5");
    act(() => button(r, "High").props.onPress());
    expect(button(r, "High").props.accessibilityState).toEqual({ selected: true });
    act(() => input(r, "Reason").props.onChangeText("needed"));
    expect(button(r, "Submit").props.disabled).toBe(false);

    act(() => input(r, "Amount").props.onChangeText(""));
    expect(button(r, "Submit").props.disabled).toBe(true);
    act(() => input(r, "Amount").props.onChangeText("3"));

    mocks.complete.mockResolvedValueOnce({ ok: false, error: { kind: "server" } });
    await act(async () => button(r, "Submit").props.onPress());
    expect(texts(r)).toContain("Unable to complete this task.");

    await act(async () => button(r, "Submit").props.onPress());
    await flush();
    expect(mocks.complete).toHaveBeenLastCalledWith(expect.anything(), {
      apiKey: "api-key",
      taskId: "wt-1",
      formData: { approved: true, reason: "needed", amount: 3, level: "high" },
    });
    expect(texts(r)).toContain("Task completed.");
  });

  it("offers a web deep-link for non-simple forms", async () => {
    const openURL = vi.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    mocks.getDetails.mockResolvedValue(
      ok(task({ assignedUsers: ["me"], formSchema: { jsonSchema: { type: "object", properties: { a: { type: "array" } } } } })),
    );
    const r = await render();
    expect(texts(r)).toContain("Finish in the web app");
    act(() => button(r, "Complete in web app").props.onPress());
    expect(openURL).toHaveBeenCalledWith(expect.stringContaining("/msp/user-activities"));
    openURL.mockRestore();
  });
});
