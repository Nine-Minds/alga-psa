import { describe, expect, it, vi } from "vitest";
import {
  auditSegments,
  cancelAssetAudit,
  completeAssetAudit,
  getAssetAudit,
  listAssetAudits,
  markAssetAuditItem,
  matchesAuditSearch,
  startAssetAudit,
  unmarkAssetAuditItem,
  type AssetAudit,
  type AssetAuditItem,
} from "./assetAudits";
import type { ApiClient } from "./client";

function mockClient(response: unknown = { ok: true, data: { data: {} } }): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

function item(asset_id: string, result: AssetAuditItem["result"], extra: Partial<AssetAuditItem> = {}): AssetAuditItem {
  return { asset_id, result, method: null, marked_at: null, marked_by: null, ...extra };
}

describe("assetAudits api", () => {
  it("wraps the seven audit routes", async () => {
    const client = mockClient();

    await startAssetAudit(client, {
      apiKey: "key-1",
      data: { client_id: "cl-1", location_id: null, statuses: ["active"] },
    });
    await listAssetAudits(client, { apiKey: "key-1", page: 1, limit: 10 });
    await getAssetAudit(client, { apiKey: "key-1", auditId: "au-1" });
    await markAssetAuditItem(client, { apiKey: "key-1", auditId: "au-1", assetId: "a-1", method: "scan" });
    await unmarkAssetAuditItem(client, { apiKey: "key-1", auditId: "au-1", assetId: "a-1" });
    await completeAssetAudit(client, { apiKey: "key-1", auditId: "au-1" });
    await cancelAssetAudit(client, { apiKey: "key-1", auditId: "au-1" });

    const calls = (client.request as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      ([req]) => `${req.method} ${req.path}`,
    );
    expect(calls).toEqual([
      "POST /api/v1/asset-audits",
      "GET /api/v1/asset-audits",
      "GET /api/v1/asset-audits/au-1",
      "POST /api/v1/asset-audits/au-1/items",
      "DELETE /api/v1/asset-audits/au-1/items/a-1",
      "POST /api/v1/asset-audits/au-1/complete",
      "POST /api/v1/asset-audits/au-1/cancel",
    ]);
  });

  it("sends the scope on start and the mark body with its method", async () => {
    const client = mockClient();

    await startAssetAudit(client, {
      apiKey: "key-1",
      data: { client_id: "cl-1", location_id: "loc-1", statuses: ["active", "in_stock"] },
    });
    await markAssetAuditItem(client, {
      apiKey: "key-1",
      auditId: "au-1",
      assetId: "a-1",
      method: "register",
      result: "unexpected",
    });

    const [start, mark] = (client.request as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([req]) => req);
    expect(start.body).toEqual({ client_id: "cl-1", location_id: "loc-1", statuses: ["active", "in_stock"] });
    expect(mark.body).toEqual({ asset_id: "a-1", result: "unexpected", method: "register" });
  });

  it("defaults a mark to present", async () => {
    const client = mockClient();

    await markAssetAuditItem(client, { apiKey: "key-1", auditId: "au-1", assetId: "a-1", method: "manual" });

    const [req] = (client.request as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(req.body.result).toBe("present");
  });

  it("splits the audit items into Remaining, Present and Unexpected", () => {
    const audit = {
      items: [
        item("a-1", "expected"),
        item("a-2", "present"),
        item("a-3", "unexpected"),
        item("a-4", "missing"),
      ],
    } as AssetAudit;

    const segments = auditSegments(audit);
    // A completed audit's missing items are what was never seen, so they stay
    // under Remaining when the session is reopened.
    expect(segments.remaining.map((row) => row.asset_id)).toEqual(["a-1", "a-4"]);
    expect(segments.present.map((row) => row.asset_id)).toEqual(["a-2"]);
    expect(segments.unexpected.map((row) => row.asset_id)).toEqual(["a-3"]);
    expect(auditSegments(null)).toEqual({ remaining: [], present: [], unexpected: [] });
  });

  it("T067 filters items by name, tag and serial", () => {
    const row = item("a-1", "expected", {
      asset_name: "Reception PC",
      asset_tag: "ECTS-014",
      serial_number: "SN-99x",
    });

    expect(matchesAuditSearch(row, "")).toBe(true);
    expect(matchesAuditSearch(row, "recep")).toBe(true);
    expect(matchesAuditSearch(row, "ects-0")).toBe(true);
    expect(matchesAuditSearch(row, "sn-99X")).toBe(true);
    expect(matchesAuditSearch(row, "nope")).toBe(false);
  });
});
