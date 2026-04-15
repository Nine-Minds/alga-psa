import { describe, expect, it, vi } from "vitest";
import { listUsers, getUserDisplayName, type UserListItem } from "./users";
import type { ApiClient } from "./client";

// --- Helpers ---------------------------------------------------------------

function makeUser(overrides: Partial<UserListItem> = {}): UserListItem {
  return {
    user_id: "u-1",
    username: "jdoe",
    first_name: "Jane",
    last_name: "Doe",
    email: "jane@example.com",
    image: null,
    avatarUrl: null,
    is_inactive: false,
    ...overrides,
  };
}

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

// --- getUserDisplayName ----------------------------------------------------

describe("getUserDisplayName", () => {
  it("returns full name when both first and last are present", () => {
    expect(getUserDisplayName(makeUser({ first_name: "Jane", last_name: "Doe" }))).toBe("Jane Doe");
  });

  it("returns first name only when last name is null", () => {
    expect(getUserDisplayName(makeUser({ first_name: "Jane", last_name: null }))).toBe("Jane");
  });

  it("returns last name only when first name is null", () => {
    expect(getUserDisplayName(makeUser({ first_name: null, last_name: "Doe" }))).toBe("Doe");
  });

  it("falls back to username when both names are null", () => {
    expect(getUserDisplayName(makeUser({ first_name: null, last_name: null, username: "jdoe" }))).toBe("jdoe");
  });

  it("falls back to username when both names are empty strings", () => {
    expect(getUserDisplayName(makeUser({ first_name: "", last_name: "", username: "jdoe" }))).toBe("jdoe");
  });
});

// --- listUsers -------------------------------------------------------------

describe("listUsers", () => {
  it("calls /api/v1/users with default params when no search provided", async () => {
    const okResponse = { ok: true, data: { data: [makeUser()] } };
    const client = mockClient(okResponse);

    const result = await listUsers(client, { apiKey: "key-123" });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/users",
      query: {
        user_type: "internal",
        is_inactive: "false",
        limit: 25,
        sort: "first_name",
        order: "asc",
      },
      headers: { "x-api-key": "key-123" },
      signal: undefined,
    });
    expect(result).toEqual(okResponse);
  });

  it("calls /api/v1/users/search when search is provided", async () => {
    const okResponse = { ok: true, data: { data: [makeUser()] } };
    const client = mockClient(okResponse);

    await listUsers(client, { apiKey: "key-123", search: "jane", limit: 10 });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/users/search",
      query: {
        query: "jane",
        fields: "first_name,last_name,email,username",
        user_type: "internal",
        include_inactive: "false",
        limit: 10,
      },
      headers: { "x-api-key": "key-123" },
      signal: undefined,
    });
  });

  it("passes abort signal through", async () => {
    const client = mockClient({ ok: true, data: { data: [] } });
    const controller = new AbortController();

    await listUsers(client, { apiKey: "key-123", signal: controller.signal });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("uses default limit of 25 when not specified", async () => {
    const client = mockClient({ ok: true, data: { data: [] } });

    await listUsers(client, { apiKey: "key-123" });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ limit: 25 }) }),
    );
  });

  it("uses custom limit when specified", async () => {
    const client = mockClient({ ok: true, data: { data: [] } });

    await listUsers(client, { apiKey: "key-123", limit: 50 });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ limit: 50 }) }),
    );
  });
});
