import { describe, expect, it, vi } from "vitest";
import { addTicketComment, type TicketComment } from "./tickets";
import type { ApiClient } from "./client";
import { parseCommentRecipients } from "../features/ticketDetail/components/CommentEmailRecipients";

function mockClient(): ApiClient {
  return {
    request: vi.fn().mockResolvedValue({ ok: true, data: { data: {} } }),
  } as unknown as ApiClient;
}

describe("mobile ticket comment Cc/Bcc", () => {
  it("T062: cc/bcc are sent only when non-empty", async () => {
    const withLists = mockClient();
    await addTicketComment(withLists, {
      apiKey: "k",
      ticketId: "t1",
      comment_text: "looping in the vendor",
      is_internal: false,
      cc: ["vendor@acme.com"],
      bcc: ["boss@msp.test"],
    });
    expect(withLists.request).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ cc: ["vendor@acme.com"], bcc: ["boss@msp.test"] }),
      }),
    );

    const withoutLists = mockClient();
    await addTicketComment(withoutLists, {
      apiKey: "k",
      ticketId: "t1",
      comment_text: "no copies",
      is_internal: false,
      cc: [],
      bcc: [],
    });
    const body = (withoutLists.request as unknown as { mock: { calls: Array<[{ body: Record<string, unknown> }]> } })
      .mock.calls[0][0].body;
    expect(body).not.toHaveProperty("cc");
    expect(body).not.toHaveProperty("bcc");
  });

  it("T064: TicketComment carries email_recipients for the list rendering", () => {
    const comment: TicketComment = {
      comment_text: "hello",
      email_recipients: { cc: [{ email: "jane@client.com", name: "Jane Doe" }], bcc: [] },
    };
    expect(comment.email_recipients?.cc?.[0]?.name).toBe("Jane Doe");
  });

  it("T063: the chip parser splits on comma/semicolon/newline and reports bad entries", () => {
    expect(parseCommentRecipients("a@b.com; c@d.com,\nnope")).toEqual({
      valid: ["a@b.com", "c@d.com"],
      invalid: ["nope"],
    });
  });
});
