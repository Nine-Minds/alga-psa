import { describe, expect, it, vi } from "vitest";
import {
  getActiveTimeSession,
  startTimeTracking,
  stopTimeTracking,
} from "./timeTracking";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("timeTracking api", () => {
  it("calls POST /api/v1/time-entries/start-tracking with full body", async () => {
    const client = mockClient({ ok: true, data: { data: { session_id: "s-1" } } });

    await startTimeTracking(client, {
      apiKey: "api-key-1",
      work_item_type: "ticket",
      work_item_id: "ticket-1",
      service_id: "service-1",
      notes: "investigating outage",
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/time-entries/start-tracking",
      headers: {
        "x-api-key": "api-key-1",
      },
      body: {
        work_item_type: "ticket",
        work_item_id: "ticket-1",
        service_id: "service-1",
        notes: "investigating outage",
      },
    });
  });

  it("omits work_item_id and notes when not provided", async () => {
    const client = mockClient({ ok: true, data: { data: { session_id: "s-1" } } });

    await startTimeTracking(client, {
      apiKey: "api-key-1",
      work_item_type: "ad_hoc",
      service_id: "service-1",
    });

    const call = (client.request as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call.body).toEqual({
      work_item_type: "ad_hoc",
      work_item_id: undefined,
      service_id: "service-1",
      notes: undefined,
    });
  });

  it("merges audit headers into the start request", async () => {
    const client = mockClient({ ok: true, data: { data: { session_id: "s-1" } } });

    await startTimeTracking(client, {
      apiKey: "api-key-1",
      work_item_type: "ticket",
      work_item_id: "ticket-1",
      service_id: "service-1",
      auditHeaders: {
        "x-device-id": "device-7",
        "x-app-version": "1.3.0",
      },
    });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          "x-api-key": "api-key-1",
          "x-device-id": "device-7",
          "x-app-version": "1.3.0",
        },
      }),
    );
  });

  it("calls GET /api/v1/time-entries/active-session", async () => {
    const client = mockClient({ ok: true, data: { data: null } });

    await getActiveTimeSession(client, { apiKey: "api-key-1" });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/time-entries/active-session",
      signal: undefined,
      headers: {
        "x-api-key": "api-key-1",
      },
    });
  });

  it("calls POST /api/v1/time-entries/stop-tracking/{sessionId} with overrides", async () => {
    const client = mockClient({ ok: true, data: { data: { entry_id: "te-1" } } });

    await stopTimeTracking(client, {
      apiKey: "api-key-1",
      sessionId: "session-1",
      end_time: "2026-07-02T15:30:00.000Z",
      notes: "resolved after reboot",
      service_id: "service-2",
      is_billable: false,
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/time-entries/stop-tracking/session-1",
      headers: {
        "x-api-key": "api-key-1",
      },
      body: {
        end_time: "2026-07-02T15:30:00.000Z",
        notes: "resolved after reboot",
        service_id: "service-2",
        is_billable: false,
      },
    });
  });

  it("stops with an empty body when no overrides are provided", async () => {
    const client = mockClient({ ok: true, data: { data: { entry_id: "te-1" } } });

    await stopTimeTracking(client, {
      apiKey: "api-key-1",
      sessionId: "session-1",
    });

    const call = (client.request as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call.body).toEqual({
      end_time: undefined,
      notes: undefined,
      service_id: undefined,
      is_billable: undefined,
    });
  });
});
