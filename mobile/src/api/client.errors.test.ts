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
    expect(r400.ok).toBe(false);
    expect(r400.error.kind).toBe("validation");
    expect(r400.error.message).toBe("Bad input");
    expect((r400.error as any).code).toBe("VALIDATION");
    expect((r400.error as any).details).toEqual({ field: "required" });

    const r401 = await client.request({ method: "GET", path: "/api/v1/test" });
    expect(r401.ok).toBe(false);
    expect(r401.error.kind).toBe("auth");
    expect((r401.error as any).status).toBe(401);

    const r403 = await client.request({ method: "GET", path: "/api/v1/test" });
    expect(r403.ok).toBe(false);
    expect(r403.error.kind).toBe("permission");
    expect((r403.error as any).status).toBe(403);

    const r500 = await client.request({ method: "GET", path: "/api/v1/test" });
    expect(r500.ok).toBe(false);
    expect(r500.error.kind).toBe("server");
    expect((r500.error as any).status).toBe(500);

    const r404 = await client.request({ method: "GET", path: "/api/v1/test" });
    expect(r404.ok).toBe(false);
    expect(r404.error.kind).toBe("http");
    expect((r404.error as any).status).toBe(404);
  });
});
