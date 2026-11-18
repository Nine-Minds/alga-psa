import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, create } from "react-test-renderer";
import type { ApiClient } from "../../../api";
import type { TicketDetail } from "../../../api/tickets";

vi.mock("../../../device/clientMetadata", () => ({
  getClientMetadataHeaders: vi.fn().mockResolvedValue({ "x-device": "test" }),
}));
vi.mock("../../../cache/ticketsCache", () => ({
  invalidateTicketsListCache: vi.fn(),
  setCachedTicketDetail: vi.fn(),
}));
vi.mock("../../../api/tickets", () => ({
  updateTicketAttributes: vi.fn(),
}));

import { updateTicketAttributes } from "../../../api/tickets";
import { invalidateTicketsListCache, setCachedTicketDetail } from "../../../cache/ticketsCache";
import { useDescriptionEditor } from "./useDescriptionEditor";

const mockUpdate = updateTicketAttributes as ReturnType<typeof vi.fn>;
const fakeClient = { request: vi.fn() } as unknown as ApiClient;
const fakeSession = { accessToken: "tok-1" };
const baseTicket = {
  ticket_id: "t-1",
  title: "T",
  attributes: { description: "Old text", other: 1 },
} as unknown as TicketDetail;
const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "New text" }] }] };
const emptyDoc = { type: "doc", content: [{ type: "paragraph" }] };

type HookReturn = ReturnType<typeof useDescriptionEditor>;

function renderDescriptionHook(opts?: { ticket?: TicketDetail | null; client?: ApiClient | null }) {
  const setTicket = vi.fn();
  const showToast = vi.fn();
  const latest: { current: HookReturn } = { current: undefined as unknown as HookReturn };
  function Wrapper() {
    const [ticket, setTicketState] = React.useState<TicketDetail | null>(
      opts?.ticket !== undefined ? opts.ticket : baseTicket,
    );
    latest.current = useDescriptionEditor({
      client: opts?.client !== undefined ? opts.client : fakeClient,
      session: fakeSession as any,
      ticketId: "t-1",
      showToast,
      t: (k: string) => k,
      ticket,
      setTicket: ((next: TicketDetail | null) => {
        setTicket(next);
        setTicketState(next);
      }) as React.Dispatch<React.SetStateAction<TicketDetail | null>>,
    });
    return null;
  }
  act(() => {
    create(React.createElement(Wrapper));
  });
  return {
    get result() {
      return latest.current;
    },
    setTicket,
    showToast,
    setEditor(getJSON: () => Promise<unknown>) {
      (latest.current.descriptionEditorRef as { current: unknown }).current = { getJSON };
    },
  };
}

describe("useDescriptionEditor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("syncs the draft from the ticket and supports start/cancel", () => {
    const h = renderDescriptionHook();
    expect(h.result.descriptionDraft).toBe("Old text");
    expect(h.result.descriptionPlainText).toBe("Old text");
    act(() => h.result.startDescriptionEditing());
    expect(h.result.descriptionEditing).toBe(true);
    act(() => h.result.setDescriptionDraft("changed"));
    act(() => h.result.cancelDescriptionEditing());
    expect(h.result.descriptionEditing).toBe(false);
    expect(h.result.descriptionDraft).toBe("Old text");
  });

  it("start/cancel do nothing without a ticket", () => {
    const h = renderDescriptionHook({ ticket: null });
    act(() => h.result.startDescriptionEditing());
    expect(h.result.descriptionEditing).toBe(false);
    act(() => h.result.cancelDescriptionEditing());
    expect(h.result.descriptionDraft).toBe("");
  });

  it("reports an editor that has not loaded yet", async () => {
    const h = renderDescriptionHook();
    let ok!: boolean;
    await act(async () => {
      ok = await h.result.saveDescription();
    });
    expect(ok).toBe(false);
    expect(h.result.descriptionError).toBe("description.editorStillLoading");
  });

  it("reports an unreadable editor", async () => {
    const h = renderDescriptionHook();
    h.setEditor(() => Promise.reject(new Error("bridge")));
    let ok!: boolean;
    await act(async () => {
      ok = await h.result.saveDescription();
    });
    expect(ok).toBe(false);
    expect(h.result.descriptionError).toBe("description.unableToReadEditor");
  });

  it("does not save without a client", async () => {
    const h = renderDescriptionHook({ client: null });
    let ok!: boolean;
    await act(async () => {
      ok = await h.result.saveDescription();
    });
    expect(ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("saves the editor content, keeping other attributes", async () => {
    const updated = { ...baseTicket, attributes: { description: JSON.stringify(doc), other: 1 } };
    mockUpdate.mockResolvedValueOnce({ ok: true, data: { data: updated } });
    const h = renderDescriptionHook();
    act(() => h.result.startDescriptionEditing());
    h.setEditor(() => Promise.resolve(doc));
    let ok!: boolean;
    await act(async () => {
      ok = await h.result.saveDescription({ suppressContactNotifications: true, suppressInternalNotifications: false });
    });
    expect(ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(fakeClient, {
      apiKey: "tok-1",
      ticketId: "t-1",
      attributes: { description: JSON.stringify(doc), other: 1 },
      notificationSuppression: { suppressContactNotifications: true, suppressInternalNotifications: false },
      auditHeaders: { "x-device": "test" },
    });
    expect(h.setTicket).toHaveBeenCalledWith(updated);
    expect(setCachedTicketDetail).toHaveBeenCalledWith("t-1", updated);
    expect(invalidateTicketsListCache).toHaveBeenCalled();
    expect(h.result.descriptionEditing).toBe(false);
    expect(h.result.descriptionPlainText).toBe("New text");
    expect(h.showToast).toHaveBeenCalledWith({ message: "notifications.suppression.successCustomer", tone: "success" });
  });

  it("clears the description, sending null when no attributes remain", async () => {
    mockUpdate.mockResolvedValueOnce({ ok: true, data: { data: { ...baseTicket, attributes: null } } });
    const h = renderDescriptionHook({
      ticket: { ...baseTicket, attributes: { description: "Only" } } as unknown as TicketDetail,
    });
    h.setEditor(() => Promise.resolve(emptyDoc));
    await act(async () => {
      await h.result.saveDescription();
    });
    expect(mockUpdate.mock.calls[0][1].attributes).toBeNull();
    expect(h.showToast).toHaveBeenCalledWith({ message: "description.descriptionUpdated", tone: "success" });
  });

  it.each([
    ["permission", { kind: "permission" }, "description.errors.permission"],
    ["validation", { kind: "validation", body: { error: { message: "Too long" } } }, "Too long"],
    ["validation fallback", { kind: "validation", body: {} }, "description.errors.validation"],
    ["server", { kind: "server" }, "description.errors.generic"],
  ])("keeps editing with an error on a %s failure", async (_l, error, expected) => {
    mockUpdate.mockResolvedValueOnce({ ok: false, error });
    const h = renderDescriptionHook();
    act(() => h.result.startDescriptionEditing());
    let ok!: boolean;
    await act(async () => {
      ok = await h.result.persistDescriptionContent("x", "x");
    });
    expect(ok).toBe(false);
    expect(h.result.descriptionError).toBe(expected);
    expect(h.result.descriptionEditing).toBe(true);
    expect(h.result.descriptionSaving).toBe(false);
    expect(h.setTicket).not.toHaveBeenCalled();
  });
});
