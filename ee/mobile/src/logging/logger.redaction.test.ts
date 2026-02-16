import { describe, expect, it } from "vitest";
import { redact } from "./logger";

describe("logger.redact", () => {
  it("redacts ticket subjects and comment bodies by key", () => {
    const input = {
      ticket: {
        title: "Printer is on fire",
        subject: "Should also redact",
      },
      comment_text: "This is an internal note with PII",
      event_text: "Status changed from New to In Progress",
      safe: {
        updated_at: "2026-02-03T00:00:00.000Z",
        status_name: "New",
      },
    };

    const out = redact(input) as any;
    expect(out.ticket.title).toBe("[REDACTED]");
    expect(out.ticket.subject).toBe("[REDACTED]");
    expect(out.comment_text).toBe("[REDACTED]");
    expect(out.event_text).toBe("[REDACTED]");
    expect(out.safe).toEqual(input.safe);
  });
});

