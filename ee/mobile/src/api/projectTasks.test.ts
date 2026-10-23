import { describe, expect, it, vi } from "vitest";
import { getProjectTask } from "./projectTasks";
import type { ApiClient } from "./client";

describe("projectTasks api", () => {
  it("calls GET /api/v1/projects/tasks/{taskId} with the api key", async () => {
    const client = { request: vi.fn().mockResolvedValue({ ok: true, data: { data: { task_id: "task-1" } } }) } as unknown as ApiClient;

    await getProjectTask(client, { apiKey: "key-1", taskId: "task-1" });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/projects/tasks/task-1",
      signal: undefined,
      headers: { "x-api-key": "key-1" },
    });
  });
});
