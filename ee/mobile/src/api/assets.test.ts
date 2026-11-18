import { describe, expect, it, vi } from "vitest";
import {
  assetStatusLabel,
  createAsset,
  listAssetStatuses,
  listAssets,
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

describe("asset list and status registry", () => {
  it("T037 serialises the filters it was given and omits the rest", async () => {
    const client = mockClient({ ok: true, data: { data: [], pagination: { page: 1, limit: 50, total: 0 } } });

    await listAssets(client, {
      apiKey: "key-1",
      page: 2,
      limit: 50,
      search: "dell",
      client_id: "cl-1",
      status: "active",
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/assets",
      signal: undefined,
      query: {
        page: 2,
        limit: 50,
        search: "dell",
        client_id: "cl-1",
        location_id: undefined,
        status: "active",
        asset_type: undefined,
        sort: "name",
        order: "asc",
      },
      headers: { "x-api-key": "key-1" },
    });
  });

  it("T037 reads the status registry and keeps each row's kind", async () => {
    const client = mockClient({
      ok: true,
      data: {
        data: [
          { slug: "in_stock", label: "In stock", kind: "deployable", display_order: 2 },
          { slug: "retired", label: "Retired", kind: "archived", display_order: 5 },
        ],
      },
    });

    const result = await listAssetStatuses(client, { apiKey: "key-1" });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/asset-statuses",
      signal: undefined,
      query: undefined,
      headers: { "x-api-key": "key-1" },
    });
    expect(result.ok && result.data.data.map((status) => status.kind)).toEqual(["deployable", "archived"]);
  });

  it("T041 labels a known slug from the registry and title-cases an unknown one", () => {
    const statuses = [{ slug: "in_stock", label: "In stock", kind: "deployable" as const }];

    expect(assetStatusLabel("in_stock", statuses)).toBe("In stock");
    expect(assetStatusLabel("custom_thing", statuses)).toBe("Custom Thing");
    expect(assetStatusLabel(null, statuses)).toBe("");
  });
});
