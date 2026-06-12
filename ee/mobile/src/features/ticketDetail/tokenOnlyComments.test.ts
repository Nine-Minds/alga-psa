import { describe, expect, it } from "vitest";
import type { TicketComment } from "../../api/tickets";
import {
  isTokenOnlyComment,
  isTokenOnlyText,
  stripAutomatedReplyMarkers,
} from "./tokenOnlyComments";

function comment(over: Partial<TicketComment> = {}): TicketComment {
  return {
    comment_id: "c1",
    comment_text: "[ALGA-REPLY-TOKEN:abc123]",
    created_at: "2026-05-18T01:00:00.000Z",
    ...over,
  };
}

describe("stripAutomatedReplyMarkers", () => {
  it("strips all marker forms and collapses whitespace", () => {
    expect(stripAutomatedReplyMarkers("[ALGA-REPLY-TOKEN:abc123]")).toBe("");
    expect(stripAutomatedReplyMarkers("\\[ALGA-REPLY-TOKEN:abc123]")).toBe("");
    expect(stripAutomatedReplyMarkers("ALGA-TICKET-ID: 42")).toBe("");
    expect(stripAutomatedReplyMarkers("--- Please reply above this line ---")).toBe("");
    expect(stripAutomatedReplyMarkers("hello\n[ALGA-REPLY-TOKEN:abc]\nworld")).toBe("hello world");
  });
});

describe("isTokenOnlyText", () => {
  it("detects a bracketed reply token", () => {
    expect(isTokenOnlyText("[ALGA-REPLY-TOKEN:abc123]")).toBe(true);
  });

  it("detects an escaped bracketed token", () => {
    expect(isTokenOnlyText("\\[ALGA-REPLY-TOKEN:abc123]")).toBe(true);
  });

  it("detects an unclosed bracketed token", () => {
    expect(isTokenOnlyText("[ALGA-REPLY-TOKEN:abc123")).toBe(true);
  });

  it("detects the bare line form", () => {
    expect(isTokenOnlyText("ALGA-REPLY-TOKEN: xyz")).toBe(true);
  });

  it("detects an ALGA-TICKET-ID line", () => {
    expect(isTokenOnlyText("ALGA-TICKET-ID: 1234")).toBe(true);
  });

  it("detects the reply-above delimiter combined with a token", () => {
    expect(
      isTokenOnlyText("--- Please reply above this line ---\n[ALGA-REPLY-TOKEN:abc123]"),
    ).toBe(true);
  });

  it("is NOT token-only when real reply text accompanies the token", () => {
    expect(isTokenOnlyText("Thanks, will do!\n[ALGA-REPLY-TOKEN:abc123]")).toBe(false);
  });

  it("is NOT token-only for plain text", () => {
    expect(isTokenOnlyText("Just a normal comment")).toBe(false);
  });

  it("is NOT token-only for an empty string", () => {
    expect(isTokenOnlyText("")).toBe(false);
    expect(isTokenOnlyText("   \n  ")).toBe(false);
  });
});

describe("isTokenOnlyComment", () => {
  it("flags a comment whose text is only a token", () => {
    expect(isTokenOnlyComment(comment())).toBe(true);
  });

  it("flags rich-editor JSON whose plain text is only a token", () => {
    const rich = JSON.stringify([
      { type: "paragraph", content: [{ type: "text", text: "[ALGA-REPLY-TOKEN:abc123]", styles: {} }] },
    ]);
    expect(isTokenOnlyComment(comment({ comment_text: rich }))).toBe(true);
  });

  it("never flags system events, even with token text", () => {
    expect(isTokenOnlyComment(comment({ kind: "event" }))).toBe(false);
    expect(isTokenOnlyComment(comment({ event_type: "status_change" }))).toBe(false);
  });

  it("does not flag an empty comment", () => {
    expect(isTokenOnlyComment(comment({ comment_text: "" }))).toBe(false);
  });

  it("does not flag a normal comment", () => {
    expect(isTokenOnlyComment(comment({ comment_text: "Looks good to me" }))).toBe(false);
  });
});
