import { describe, expect, it, vi } from "vitest";
import {
  discardStopwatch,
  getActiveStopwatch,
  getOpenSessionFromConflict,
  logStopwatch,
  pauseStopwatch,
  resumeStopwatch,
  startStopwatch,
  updateStopwatch,
} from "./stopwatch";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

function firstCall(client: ApiClient) {
  return (client.request as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
}

describe("stopwatch api", () => {
  it("starts a session with POST /api/v1/stopwatch and merges audit headers", async () => {
    const client = mockClient({ ok: true });
    await startStopwatch(client, {
      apiKey: "k",
      work_item_type: "ticket",
      work_item_id: "t-1",
      service_id: "s-1",
      auditHeaders: { "x-device-id": "d-1" },
    });
    expect(firstCall(client)).toEqual({
      method: "POST",
      path: "/api/v1/stopwatch",
      headers: { "x-api-key": "k", "x-device-id": "d-1" },
      body: { work_item_type: "ticket", work_item_id: "t-1", service_id: "s-1", notes: undefined },
    });
  });

  it("reads GET /api/v1/stopwatch/active", async () => {
    const client = mockClient({ ok: true });
    await getActiveStopwatch(client, { apiKey: "k" });
    expect(firstCall(client)).toEqual({
      method: "GET",
      path: "/api/v1/stopwatch/active",
      signal: undefined,
      headers: { "x-api-key": "k" },
    });
  });

  it("pauses and resumes by session id", async () => {
    const a = mockClient({ ok: true });
    await pauseStopwatch(a, { apiKey: "k", sessionId: "s-1" });
    expect(firstCall(a)).toMatchObject({ method: "POST", path: "/api/v1/stopwatch/s-1/pause" });
    const b = mockClient({ ok: true });
    await resumeStopwatch(b, { apiKey: "k", sessionId: "s-1" });
    expect(firstCall(b)).toMatchObject({ method: "POST", path: "/api/v1/stopwatch/s-1/resume" });
  });

  it("patches notes and service", async () => {
    const client = mockClient({ ok: true });
    await updateStopwatch(client, { apiKey: "k", sessionId: "s-1", notes: "n" });
    expect(firstCall(client)).toMatchObject({
      method: "PATCH",
      path: "/api/v1/stopwatch/s-1",
      body: { notes: "n", service_id: undefined },
    });
  });

  it("logs through POST /{id}/log with overrides", async () => {
    const client = mockClient({ ok: true });
    await logStopwatch(client, {
      apiKey: "k",
      sessionId: "s-1",
      start_time: "2026-07-02T11:30:00.000Z",
      end_time: "2026-07-02T12:00:00.000Z",
      is_billable: false,
      notes: "done",
      service_id: "s-2",
    });
    expect(firstCall(client)).toEqual({
      method: "POST",
      path: "/api/v1/stopwatch/s-1/log",
      headers: { "x-api-key": "k" },
      body: {
        start_time: "2026-07-02T11:30:00.000Z",
        end_time: "2026-07-02T12:00:00.000Z",
        billable_duration: undefined,
        is_billable: false,
        notes: "done",
        service_id: "s-2",
      },
    });
  });

  it("discards with DELETE /{id}", async () => {
    const client = mockClient({ ok: true });
    await discardStopwatch(client, { apiKey: "k", sessionId: "s-1" });
    expect(firstCall(client)).toMatchObject({ method: "DELETE", path: "/api/v1/stopwatch/s-1" });
  });

  it("extracts the open session from a 409 body", () => {
    const body = { error: { code: "CONFLICT", details: { open_session: { session_id: "x" } } } };
    expect(getOpenSessionFromConflict(body)).toEqual({ session_id: "x" });
    expect(getOpenSessionFromConflict({ error: {} })).toBeNull();
    expect(getOpenSessionFromConflict(undefined)).toBeNull();
  });
});
