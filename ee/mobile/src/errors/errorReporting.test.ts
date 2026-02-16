import { describe, expect, it } from "vitest";
import { buildErrorReportPayload } from "./errorReporting";

describe("buildErrorReportPayload", () => {
  it("omits request/response bodies from nested payloads", () => {
    const payload = buildErrorReportPayload(
      {
        message: "Boom",
        request: { method: "POST", body: "secret" },
        response: { status: 500, body: { raw: "sensitive" } },
      },
      {
        body: { any: "thing" },
        requestBody: "abc",
        responseBody: "def",
        nested: { request_body: "ghi", response_body: "jkl" },
      },
    );

    expect(payload).toEqual({
      error: {
        message: "Boom",
        request: { method: "POST", body: "[omitted]" },
        response: { status: 500, body: "[omitted]" },
      },
      context: {
        body: "[omitted]",
        requestBody: "[omitted]",
        responseBody: "[omitted]",
        nested: { request_body: "[omitted]", response_body: "[omitted]" },
      },
    });
  });
});

