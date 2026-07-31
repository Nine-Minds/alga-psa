import { describe, expect, it, vi } from "vitest";
import {
  createAsset,
  getAssetNotes,
  getAssetSoftware,
  recordAssetMaintenance,
  saveAssetNotes,
} from "./assets";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("assets api", () => {
  it("createAsset POSTs to /api/v1/assets with the device fields", async () => {
    const client = mockClient({ ok: true, data: { data: { asset_id: "as-1" } } });
    await createAsset(client, {
      apiKey: "k",
      data: {
        client_id: "cl-1",
        asset_type: "printer",
        asset_tag: "SN-1",
        name: "Front desk printer",
        status: "active",
        serial_number: "SN-1",
      },
    });
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/assets",
        headers: { "x-api-key": "k" },
        body: expect.objectContaining({ client_id: "cl-1", asset_tag: "SN-1", asset_type: "printer" }),
      }),
    );
  });

  it("recordAssetMaintenance POSTs to the maintenance/record endpoint", async () => {
    const client = mockClient({ ok: true, data: { data: {} } });
    await recordAssetMaintenance(client, {
      apiKey: "k",
      assetId: "as-1",
      data: { schedule_id: "sch-1", maintenance_type: "preventive", description: "cleaned" },
    });
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/assets/as-1/maintenance/record",
        body: { schedule_id: "sch-1", maintenance_type: "preventive", description: "cleaned" },
      }),
    );
  });

  it("getAssetSoftware GETs the software endpoint", async () => {
    const client = mockClient({ ok: true, data: { data: [] } });
    await getAssetSoftware(client, { apiKey: "k", assetId: "as-1" });
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/api/v1/assets/as-1/software" }),
    );
  });

  it("getAssetNotes GETs the notes endpoint", async () => {
    const client = mockClient({ ok: true, data: { data: { document: null, blockData: null, lastUpdated: null } } });
    await getAssetNotes(client, { apiKey: "k", assetId: "as-1" });
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/api/v1/assets/as-1/notes" }),
    );
  });

  it("saveAssetNotes PUTs the whole blockData document back", async () => {
    const client = mockClient({ ok: true, data: { data: {} } });
    const blockData = [{ type: "paragraph", content: [{ type: "text", text: "hi", styles: {} }] }];
    await saveAssetNotes(client, { apiKey: "k", assetId: "as-1", blockData });
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        path: "/api/v1/assets/as-1/notes",
        body: { blockData },
      }),
    );
  });
});
