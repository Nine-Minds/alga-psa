import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createApiClient error mapping", () => {
  it("maps server error shapes to validation/auth/permission/server/http kinds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "VALIDATION", message: "Bad input", details: { field: "required" } } },
          400,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Unauthorized" } }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Forbidden" } }, 403))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Boom" } }, 500))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Missing" } }, 404));

    const client = createApiClient({
      baseUrl: "https://example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
    });

    const r400 = await client.request({ method: "GET", path: "/api/v1/test" });
    if (r400.ok) throw new Error("expected 400 error");
    if (r400.error.kind !== "validation") throw new Error(`expected validation, got ${r400.error.kind}`);
    expect(r400.error.message).toBe("Bad input");
    expect(r400.error.code).toBe("VALIDATION");
    expect(r400.error.details).toEqual({ field: "required" });

    const r401 = await client.request({ method: "GET", path: "/api/v1/test" });
    if (r401.ok) throw new Error("expected 401 error");
    if (r401.error.kind !== "auth") throw new Error(`expected auth, got ${r401.error.kind}`);
    expect(r401.error.status).toBe(401);

    const r403 = await client.request({ method: "GET", path: "/api/v1/test" });
    if (r403.ok) throw new Error("expected 403 error");
    if (r403.error.kind !== "permission") throw new Error(`expected permission, got ${r403.error.kind}`);
    expect(r403.error.status).toBe(403);

    const r500 = await client.request({ method: "GET", path: "/api/v1/test" });
    if (r500.ok) throw new Error("expected 500 error");
    if (r500.error.kind !== "server") throw new Error(`expected server, got ${r500.error.kind}`);
    expect(r500.error.status).toBe(500);

    const r404 = await client.request({ method: "GET", path: "/api/v1/test" });
    if (r404.ok) throw new Error("expected 404 error");
    if (r404.error.kind !== "http") throw new Error(`expected http, got ${r404.error.kind}`);
    expect(r404.error.status).toBe(404);
  });
});
