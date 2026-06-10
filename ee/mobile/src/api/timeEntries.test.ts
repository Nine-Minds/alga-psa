import { describe, expect, it, vi } from "vitest";
import { createTimeEntry, getServices, getTicketTimeEntries, listTimeEntries, listTimePeriods } from "./timeEntries";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("timeEntries api", () => {
  it("calls GET /api/v1/services with is_active=true and limit=100", async () => {
    const client = mockClient({ ok: true, data: { data: [] } });

    await getServices(client, { apiKey: "api-key-1" });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/services?is_active=true&limit=100",
      headers: {
        "x-api-key": "api-key-1",
      },
    });
  });

  it("calls GET /api/v1/tickets/{id}/time-entries", async () => {
    const client = mockClient({ ok: true, data: { data: { entries: [] } } });

    await getTicketTimeEntries(client, {
      apiKey: "api-key-1",
      ticketId: "ticket-1",
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/tickets/ticket-1/time-entries",
      headers: {
        "x-api-key": "api-key-1",
      },
    });
  });

  it("calls POST /api/v1/time-entries with full body", async () => {
    const client = mockClient({ ok: true, data: { data: { entry_id: "te-1" } } });

    await createTimeEntry(client, {
      apiKey: "api-key-1",
      work_item_type: "ticket",
      work_item_id: "ticket-1",
      service_id: "service-1",
      start_time: "2026-05-05T09:00:00.000Z",
      end_time: "2026-05-05T09:15:00.000Z",
      notes: "fixed printer",
      is_billable: true,
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/time-entries",
      headers: {
        "x-api-key": "api-key-1",
      },
      body: {
        work_item_type: "ticket",
        work_item_id: "ticket-1",
        service_id: "service-1",
        start_time: "2026-05-05T09:00:00.000Z",
        end_time: "2026-05-05T09:15:00.000Z",
        notes: "fixed printer",
        is_billable: true,
      },
    });
  });

  it("merges audit headers into the request headers", async () => {
    const client = mockClient({ ok: true, data: { data: { entry_id: "te-1" } } });

    await createTimeEntry(client, {
      apiKey: "api-key-1",
      work_item_type: "ticket",
      work_item_id: "ticket-1",
      service_id: "service-1",
      start_time: "2026-05-05T09:00:00.000Z",
      end_time: "2026-05-05T09:15:00.000Z",
      auditHeaders: {
        "x-device-id": "device-7",
        "x-app-version": "1.2.3",
      },
    });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          "x-api-key": "api-key-1",
          "x-device-id": "device-7",
          "x-app-version": "1.2.3",
        },
      }),
    );
  });

  it("calls GET /api/v1/time-periods", async () => {
    const client = mockClient({ ok: true, data: { data: [] } });

    await listTimePeriods(client, { apiKey: "api-key-1" });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/time-periods",
      signal: undefined,
      headers: {
        "x-api-key": "api-key-1",
      },
    });
  });

  it("calls GET /api/v1/time-entries with filters and default sort", async () => {
    const client = mockClient({ ok: true, data: { data: [], pagination: { hasNext: false } } });

    await listTimeEntries(client, {
      apiKey: "api-key-1",
      page: 1,
      limit: 100,
      user_id: "user-1",
      date_from: "2026-06-01",
      date_to: "2026-06-15",
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/time-entries",
      signal: undefined,
      query: {
        page: 1,
        limit: 100,
        sort: "start_time",
        order: "desc",
        user_id: "user-1",
        date_from: "2026-06-01",
        date_to: "2026-06-15",
      },
      headers: {
        "x-api-key": "api-key-1",
      },
    });
  });

  it("omits unset time entry filters and honors custom sort", async () => {
    const client = mockClient({ ok: true, data: { data: [], pagination: { hasNext: false } } });

    await listTimeEntries(client, {
      apiKey: "api-key-1",
      page: 2,
      limit: 25,
      sort: "work_date",
      order: "asc",
    });

    const call = (client.request as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call.query).toEqual({
      page: 2,
      limit: 25,
      sort: "work_date",
      order: "asc",
      user_id: undefined,
      date_from: undefined,
      date_to: undefined,
    });
  });

  it("omits notes and is_billable when not provided", async () => {
    const client = mockClient({ ok: true, data: { data: { entry_id: "te-1" } } });

    await createTimeEntry(client, {
      apiKey: "api-key-1",
      work_item_type: "ad_hoc",
      service_id: "service-1",
      start_time: "2026-05-05T09:00:00.000Z",
      end_time: "2026-05-05T09:15:00.000Z",
    });

    const call = (client.request as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call.body).toEqual({
      work_item_type: "ad_hoc",
      work_item_id: undefined,
      service_id: "service-1",
      start_time: "2026-05-05T09:00:00.000Z",
      end_time: "2026-05-05T09:15:00.000Z",
      notes: undefined,
      is_billable: undefined,
    });
  });
});
