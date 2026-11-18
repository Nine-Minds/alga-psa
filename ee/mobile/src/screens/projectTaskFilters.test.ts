import { describe, expect, it } from "vitest";
import type { ProjectTaskSummary } from "../api/projects";
import {
  EMPTY_TASK_FILTERS,
  assigneeOptions,
  filterProjectTasks,
  hasActiveTaskFilters,
  taskMatchesQuery,
} from "./projectTaskFilters";

const TASKS: ProjectTaskSummary[] = [
  { task_id: "t-1", phase_id: "ph-1", task_name: "Walk the floor", description: "Measure the server room", assigned_to: "u-ada", project_status_mapping_id: "m-done" },
  { task_id: "t-2", phase_id: "ph-1", task_name: "Draw the plan", wbs_code: "1.2", assigned_to: "u-tin", project_status_mapping_id: "m-open" },
  { task_id: "t-3", phase_id: "ph-2", task_name: "Order switches", description: null, assigned_to: null, project_status_mapping_id: "m-open" },
  { task_id: "t-4", phase_id: "ph-2", task_name: "Sign off", assigned_to: "u-ada", project_status_mapping_id: "m-review" },
];
const NAMES = new Map([
  ["u-ada", "Ada Byron"],
  ["u-tin", "Tin Man"],
]);
const context = { meUserId: "u-ada", assigneeNames: NAMES };
const ids = (tasks: ProjectTaskSummary[]) => tasks.map((task) => task.task_id);

describe("project task filters", () => {
  it("is inactive by default and active once anything is set", () => {
    expect(hasActiveTaskFilters(EMPTY_TASK_FILTERS)).toBe(false);
    expect(hasActiveTaskFilters({ ...EMPTY_TASK_FILTERS, query: "   " })).toBe(false);
    expect(hasActiveTaskFilters({ ...EMPTY_TASK_FILTERS, query: "plan" })).toBe(true);
    expect(hasActiveTaskFilters({ ...EMPTY_TASK_FILTERS, statusMappingIds: ["m-open"] })).toBe(true);
    expect(hasActiveTaskFilters({ ...EMPTY_TASK_FILTERS, assignee: "me" })).toBe(true);
  });

  it("matches words across name, description, WBS code and assignee", () => {
    expect(taskMatchesQuery(TASKS[0], "server room")).toBe(true);
    expect(taskMatchesQuery(TASKS[0], "room floor")).toBe(true); // words may span fields
    expect(taskMatchesQuery(TASKS[1], "1.2")).toBe(true);
    expect(taskMatchesQuery(TASKS[1], "tin", "Tin Man")).toBe(true);
    expect(taskMatchesQuery(TASKS[2], "switches order")).toBe(true);
    expect(taskMatchesQuery(TASKS[2], "router")).toBe(false);
  });

  it("filters by text case-insensitively", () => {
    expect(ids(filterProjectTasks(TASKS, { ...EMPTY_TASK_FILTERS, query: "  THE  " }, context))).toEqual(["t-1", "t-2"]);
    expect(ids(filterProjectTasks(TASKS, { ...EMPTY_TASK_FILTERS, query: "ada" }, context))).toEqual(["t-1", "t-4"]);
  });

  it("filters by any of the selected statuses", () => {
    expect(ids(filterProjectTasks(TASKS, { ...EMPTY_TASK_FILTERS, statusMappingIds: ["m-open"] }, context))).toEqual(["t-2", "t-3"]);
    expect(
      ids(filterProjectTasks(TASKS, { ...EMPTY_TASK_FILTERS, statusMappingIds: ["m-open", "m-review"] }, context)),
    ).toEqual(["t-2", "t-3", "t-4"]);
  });

  it("filters by assignee including me and unassigned", () => {
    expect(ids(filterProjectTasks(TASKS, { ...EMPTY_TASK_FILTERS, assignee: "me" }, context))).toEqual(["t-1", "t-4"]);
    expect(ids(filterProjectTasks(TASKS, { ...EMPTY_TASK_FILTERS, assignee: "unassigned" }, context))).toEqual(["t-3"]);
    expect(ids(filterProjectTasks(TASKS, { ...EMPTY_TASK_FILTERS, assignee: { userId: "u-tin" } }, context))).toEqual(["t-2"]);
    expect(ids(filterProjectTasks(TASKS, { ...EMPTY_TASK_FILTERS, assignee: "me" }, { ...context, meUserId: null }))).toEqual([]);
  });

  it("combines text, status and assignee", () => {
    const filters = { query: "sign", statusMappingIds: ["m-review"], assignee: "me" as const };
    expect(ids(filterProjectTasks(TASKS, filters, context))).toEqual(["t-4"]);
  });

  it("lists assignees busiest first with their names", () => {
    expect(assigneeOptions(TASKS, NAMES)).toEqual([
      { userId: "u-ada", name: "Ada Byron", count: 2 },
      { userId: "u-tin", name: "Tin Man", count: 1 },
    ]);
  });
});
