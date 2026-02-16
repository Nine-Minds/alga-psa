import { describe, expect, it } from "vitest";
import { getClipboardText } from "./clipboardLogic";

describe("clipboard redaction", () => {
  it("redacts Bearer tokens by default", () => {
    const res = getClipboardText("accessToken", "Bearer abc123");
    expect(res.redacted).toBe(true);
    expect(res.text).toMatch(/^Bearer \[REDACTED\]$/);
  });

  it("does not redact UUIDs by default", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const res = getClipboardText("ticketId", uuid);
    expect(res.redacted).toBe(false);
    expect(res.text).toBe(uuid);
  });

  it("allows copying sensitive text when explicitly allowed", () => {
    const res = getClipboardText("refreshToken", "Bearer abc123", { allowSensitive: true });
    expect(res.redacted).toBe(false);
    expect(res.text).toBe("Bearer abc123");
  });
});
