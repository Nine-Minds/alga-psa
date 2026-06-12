import { describe, expect, it, vi } from "vitest";
import {
  createScheduleEntry,
  deleteScheduleEntry,
  listScheduleEntries,
  updateScheduleEntry,
} from "./schedule";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("schedule api", () => {
  it("calls GET /api/v1/schedules with date range and user filter", async () => {
    const client = mockClient({ ok: true, data: { data: [] } });
    const signal = new AbortController().signal;

    await listScheduleEntries(client, {
      apiKey: "api-key-1",
      startDate: "2026-06-08T00:00:00.000Z",
      endDate: "2026-06-14T23:59:59.999Z",
      userId: "user-1",
      signal,
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/schedules",
      signal,
      query: {
        start_date: "2026-06-08T00:00:00.000Z",
        end_date: "2026-06-14T23:59:59.999Z",
        user_id: "user-1",
      },
      headers: {
        "x-api-key": "api-key-1",
      },
    });
  });

  it("omits user_id when not provided", async () => {
    const client = mockClient({ ok: true, data: { data: [] } });

    await listScheduleEntries(client, {
      apiKey: "api-key-1",
      startDate: "2026-06-08T00:00:00.000Z",
      endDate: "2026-06-14T23:59:59.999Z",
    });

    const call = (client.request as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call.query).toEqual({
      start_date: "2026-06-08T00:00:00.000Z",
      end_date: "2026-06-14T23:59:59.999Z",
      user_id: undefined,
    });
  });

  it("calls POST /api/v1/schedules with the entry body", async () => {
    const client = mockClient({ ok: true, data: { data: { entry_id: "se-1" } } });

    await createScheduleEntry(client, {
      apiKey: "api-key-1",
      entry: {
        title: "Standup",
        scheduled_start: "2026-06-09T09:00:00.000Z",
        scheduled_end: "2026-06-09T09:30:00.000Z",
        work_item_type: "meeting",
        assigned_user_ids: ["user-1"],
        notes: "daily",
      },
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/schedules",
      headers: {
        "x-api-key": "api-key-1",
      },
      body: {
        title: "Standup",
        scheduled_start: "2026-06-09T09:00:00.000Z",
        scheduled_end: "2026-06-09T09:30:00.000Z",
        work_item_type: "meeting",
        assigned_user_ids: ["user-1"],
        notes: "daily",
      },
    });
  });

  it("calls PUT /api/v1/schedules/{id} with partial body", async () => {
    const client = mockClient({ ok: true, data: { data: { entry_id: "se-1" } } });

    await updateScheduleEntry(client, {
      apiKey: "api-key-1",
      entryId: "se-1",
      entry: {
        title: "Standup (moved)",
        scheduled_start: "2026-06-09T10:00:00.000Z",
        scheduled_end: "2026-06-09T10:30:00.000Z",
      },
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "PUT",
      path: "/api/v1/schedules/se-1",
      headers: {
        "x-api-key": "api-key-1",
      },
      body: {
        title: "Standup (moved)",
        scheduled_start: "2026-06-09T10:00:00.000Z",
        scheduled_end: "2026-06-09T10:30:00.000Z",
      },
    });
  });

  it("calls DELETE /api/v1/schedules/{id}", async () => {
    const client = mockClient({ ok: true, status: 204, data: undefined });

    await deleteScheduleEntry(client, { apiKey: "api-key-1", entryId: "se-1" });

    expect(client.request).toHaveBeenCalledWith({
      method: "DELETE",
      path: "/api/v1/schedules/se-1",
      headers: {
        "x-api-key": "api-key-1",
      },
    });
  });
});
