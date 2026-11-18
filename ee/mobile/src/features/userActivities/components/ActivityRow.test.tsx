import React from "react";
import { Pressable, Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { Activity } from "../../../api/activities";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  translate: (key: string, defOrOpts?: string | Record<string, unknown>, optsArg?: Record<string, unknown>) => {
    const opts = typeof defOrOpts === "object" ? defOrOpts : optsArg;
    let out = typeof defOrOpts === "string" ? defOrOpts : ((opts?.defaultValue as string | undefined) ?? key);
    if (opts) for (const [n, v] of Object.entries(opts)) out = out.replaceAll(`{{${n}}}`, String(v));
    return out;
  },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.translate }) }));
vi.mock("../../../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../../../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../../../ui/formatters/dateTime", () => ({ formatDateShort: (v: string) => `D(${v})` }));
vi.mock("../../schedule/scheduleUtils", () => ({ formatTimeRange: (a: string, b: string) => `R(${a}-${b})` }));

import { ActivityRow } from "./ActivityRow";

function make(extra: Record<string, unknown>): Activity {
  return {
    id: "a1",
    title: "Fix printer",
    status: "in_progress",
    priority: "high",
    sourceId: "s1",
    sourceType: "ticket",
    actions: [],
    tenant: "t",
    createdAt: "",
    updatedAt: "",
    type: "ticket",
    ...extra,
  } as Activity;
}

function render(activity: Activity, onPress = vi.fn()): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(<ActivityRow activity={activity} onPress={onPress} />);
  });
  return r;
}

function texts(r: ReactTestRenderer): string[] {
  return r.root.findAllByType(Text).map((n) => {
    const v = n.props.children;
    return Array.isArray(v) ? v.join("") : String(v);
  });
}

describe("ActivityRow", () => {
  it("renders a ticket with number/client subtitle, humanized status/priority and assignees; press forwards activity", () => {
    const onPress = vi.fn();
    const a = make({ ticketNumber: "T-1", clientName: "Acme", priorityName: "urgent_now", assignedToNames: ["Ann", "Bob"] });
    const r = render(a, onPress);
    const all = texts(r);
    expect(all).toContain("Ticket • T-1 • Acme");
    expect(all).toContain("Fix printer");
    expect(all).toContain("In Progress");
    expect(all).toContain("Urgent Now");
    expect(all).toContain("Assigned to Ann, Bob");
    const pressable = r.root.findAllByType(Pressable)[0];
    expect(pressable.props.accessibilityLabel).toBe("Ticket: Fix printer");
    act(() => pressable.props.onPress());
    expect(onPress).toHaveBeenCalledWith(a);
  });

  it("strikes through closed activities and falls back to unknown status", () => {
    const r = render(make({ isClosed: true, status: "" }));
    const title = r.root.findAllByType(Text).find((n) => n.props.children === "Fix printer")!;
    expect(title.props.style.textDecorationLine).toBe("line-through");
    expect(texts(r)).toContain("common:unknown");
  });

  it.each([
    [{ type: "projectTask", projectName: "Move", phaseName: "Phase 1" }, "Project task • Move • Phase 1"],
    [{ type: "projectTask" }, "Project task"],
    [{ type: "ticket" }, "Ticket"],
    [{ type: "schedule", startDate: "s", endDate: "e" }, "Schedule • D(s) • R(s-e)"],
    [{ type: "schedule", startDate: "s" }, "Schedule • D(s)"],
    [{ type: "schedule" }, "Schedule"],
    [{ type: "schedule", workItemType: "ad_hoc", startDate: "s", endDate: "e" }, "Ad-hoc • D(s) • R(s-e)"],
    [{ type: "schedule", workItemType: "ad_hoc", startDate: "s" }, "Ad-hoc • D(s)"],
    [{ type: "schedule", workItemType: "ad_hoc" }, "Ad-hoc • No date"],
    [{ type: "timeEntry", workItemType: "project_task" }, "Time entry • Project Task"],
    [{ type: "timeEntry" }, "Time entry"],
    [{ type: "workflowTask", dueDate: "d" }, "Workflow task • Due D(d)"],
    [{ type: "workflowTask" }, "Workflow task"],
    [{ type: "notification", message: "Hello" }, "Notification • Hello"],
    [{ type: "document", documentName: "spec.pdf" }, "Document • spec.pdf"],
  ])("builds the subtitle for %o", (extra, expected) => {
    const r = render(make(extra));
    expect(texts(r)[0]).toBe(expected);
  });
});
