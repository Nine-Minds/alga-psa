import { describe, expect, it, vi } from "vitest";
import {
  buildContactAvatarUri,
  formatContactTypeLabel,
  getContact,
  getContactReachLine,
  listContacts,
  type ContactListItem,
} from "./contacts";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("listContacts", () => {
  it("calls GET /api/v1/contacts with pagination and active-only defaults", async () => {
    const client = mockClient({ ok: true, data: { data: [], pagination: {} } });

    await listContacts(client, { apiKey: "api-key-1", page: 2, limit: 25 });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/contacts",
      signal: undefined,
      query: {
        page: 2,
        limit: 25,
        sort: "full_name",
        order: "asc",
        is_inactive: "false",
      },
      headers: {
        "x-api-key": "api-key-1",
      },
    });
  });

  it("includes search and client_id when provided", async () => {
    const client = mockClient({ ok: true, data: { data: [], pagination: {} } });
    const abortController = new AbortController();

    await listContacts(client, {
      apiKey: "api-key-1",
      page: 1,
      limit: 10,
      search: "alice",
      client_id: "client-7",
      sort: "client_name",
      order: "desc",
      signal: abortController.signal,
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/contacts",
      signal: abortController.signal,
      query: {
        page: 1,
        limit: 10,
        sort: "client_name",
        order: "desc",
        is_inactive: "false",
        search: "alice",
        client_id: "client-7",
      },
      headers: {
        "x-api-key": "api-key-1",
      },
    });
  });

  it("omits empty search", async () => {
    const client = mockClient({ ok: true, data: { data: [], pagination: {} } });

    await listContacts(client, { apiKey: "api-key-1", page: 1, limit: 25, search: "" });

    const call = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.query).not.toHaveProperty("search");
  });
});

describe("getContact", () => {
  it("calls GET /api/v1/contacts/{id}", async () => {
    const client = mockClient({ ok: true, data: { data: {} } });

    await getContact(client, { apiKey: "api-key-1", contactId: "contact-9" });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/contacts/contact-9",
      signal: undefined,
      headers: {
        "x-api-key": "api-key-1",
      },
    });
  });
});

describe("formatContactTypeLabel", () => {
  it("prefers a custom type over the canonical type", () => {
    expect(formatContactTypeLabel({ canonical_type: "work", custom_type: "Direct line" })).toBe("Direct line");
  });

  it("capitalizes the canonical type", () => {
    expect(formatContactTypeLabel({ canonical_type: "mobile", custom_type: null })).toBe("Mobile");
    expect(formatContactTypeLabel({ canonical_type: "WORK", custom_type: "" })).toBe("Work");
  });

  it("returns null when no type is set", () => {
    expect(formatContactTypeLabel({ canonical_type: null, custom_type: null })).toBeNull();
    expect(formatContactTypeLabel({ canonical_type: "  ", custom_type: "  " })).toBeNull();
  });
});

describe("getContactReachLine", () => {
  const base: ContactListItem = { contact_name_id: "c1", full_name: "Alice" };

  it("prefers the default phone number", () => {
    expect(
      getContactReachLine({ ...base, default_phone_number: "555-1234", email: "alice@example.com" }),
    ).toBe("555-1234");
  });

  it("falls back to the email", () => {
    expect(getContactReachLine({ ...base, default_phone_number: "  ", email: "alice@example.com" })).toBe(
      "alice@example.com",
    );
  });

  it("returns null when neither is set", () => {
    expect(getContactReachLine(base)).toBeNull();
  });
});

describe("buildContactAvatarUri", () => {
  it("prefixes relative paths with the base url", () => {
    expect(buildContactAvatarUri("https://host.example", "/api/avatar/1")).toBe(
      "https://host.example/api/avatar/1",
    );
    expect(buildContactAvatarUri("https://host.example/", "api/avatar/1")).toBe(
      "https://host.example/api/avatar/1",
    );
  });

  it("passes through absolute urls", () => {
    expect(buildContactAvatarUri("https://host.example", "https://cdn.example/a.png")).toBe(
      "https://cdn.example/a.png",
    );
  });

  it("returns undefined without an avatar or base url", () => {
    expect(buildContactAvatarUri("https://host.example", null)).toBeUndefined();
    expect(buildContactAvatarUri(null, "/api/avatar/1")).toBeUndefined();
  });
});
