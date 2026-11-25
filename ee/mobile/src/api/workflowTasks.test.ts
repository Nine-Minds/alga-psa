import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import {
  claimWorkflowTask,
  completeWorkflowTask,
  getWorkflowTaskDetails,
  listWorkflowTasks,
  unclaimWorkflowTask,
} from "./workflowTasks";

function mockClient(response: unknown = { ok: true, data: { data: { success: true } } }): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("workflowTasks api", () => {
  it("lists tasks with paging + status filter and the api key header", async () => {
    const page = { ok: true, data: { data: [{ taskId: "t1" }], pagination: { total: 1 } } };
    const client = mockClient(page);
    const signal = new AbortController().signal;
    const result = await listWorkflowTasks(client, { apiKey: "k", page: 2, pageSize: 50, status: "pending", signal });
    expect(result).toBe(page);
    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/workflows/tasks",
      signal,
      query: { page: 2, pageSize: 50, status: "pending" },
      headers: { "x-api-key": "k" },
    });
  });

  it("fetches a single task's details", async () => {
    const client = mockClient();
    await getWorkflowTaskDetails(client, { apiKey: "k", taskId: "task-9" });
    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/workflows/tasks/task-9",
      signal: undefined,
      headers: { "x-api-key": "k" },
    });
  });

  it("claims and unclaims via POST", async () => {
    const client = mockClient();
    await claimWorkflowTask(client, { apiKey: "k", taskId: "t1" });
    await unclaimWorkflowTask(client, { apiKey: "k", taskId: "t1" });
    expect(client.request).toHaveBeenNthCalledWith(1, {
      method: "POST",
      path: "/api/v1/workflows/tasks/t1/claim",
      headers: { "x-api-key": "k" },
    });
    expect(client.request).toHaveBeenNthCalledWith(2, {
      method: "POST",
      path: "/api/v1/workflows/tasks/t1/unclaim",
      headers: { "x-api-key": "k" },
    });
  });

  it("completes with formData and only includes comments when non-empty", async () => {
    const client = mockClient();
    await completeWorkflowTask(client, { apiKey: "k", taskId: "t1", formData: { approved: true }, comments: "ok" });
    await completeWorkflowTask(client, { apiKey: "k", taskId: "t1", formData: { approved: false }, comments: "" });
    const calls = (client.request as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toEqual({
      method: "POST",
      path: "/api/v1/workflows/tasks/t1/complete",
      headers: { "x-api-key": "k" },
      body: { formData: { approved: true }, comments: "ok" },
    });
    expect(calls[1][0].body).toEqual({ formData: { approved: false } });
  });
});
