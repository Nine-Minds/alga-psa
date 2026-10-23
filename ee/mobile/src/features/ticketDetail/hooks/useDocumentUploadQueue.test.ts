import React from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../api/client";

vi.mock("../../../api/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/documents")>()),
  uploadTicketDocument: vi.fn(),
}));

import { uploadTicketDocument } from "../../../api/documents";
import { useDocumentUploadQueue } from "./useDocumentUploadQueue";

const uploadMock = uploadTicketDocument as ReturnType<typeof vi.fn>;
const client = { request: vi.fn() } as unknown as ApiClient;

type HookReturn = ReturnType<typeof useDocumentUploadQueue>;

async function renderHook(onUploaded = vi.fn()) {
  const latest: { current: HookReturn } = { current: undefined as unknown as HookReturn };
  function Wrapper() {
    latest.current = useDocumentUploadQueue({ client, apiKey: "key", ticketId: "t-1", onUploaded, fallbackError: "fallback" });
    return null;
  }
  await act(async () => { create(React.createElement(Wrapper)); });
  return { latest, onUploaded };
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

const file = (name: string) => ({ uri: `file:///${name}`, name, mimeType: "image/jpeg" });

describe("useDocumentUploadQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadMock.mockResolvedValue({ ok: true, data: { data: {} } });
  });

  it("uploads enqueued files strictly one at a time and notifies after each success", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    uploadMock.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { ok: true, data: { data: {} } };
    });
    const { latest, onUploaded } = await renderHook();

    await act(async () => { latest.current.enqueue([file("a"), file("b"), file("c")]); });
    await settle();

    expect(uploadMock).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(1);
    expect(onUploaded).toHaveBeenCalledTimes(3);
    expect(latest.current.items).toEqual([]);
    expect(latest.current.uploading).toBe(false);
  });

  it("reports batch progress and folds files enqueued mid-batch into the same total", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    uploadMock.mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve); }));
    const { latest } = await renderHook();

    await act(async () => { latest.current.enqueue([file("a"), file("b")]); });
    expect(latest.current.progress).toEqual({ current: 1, total: 2 });

    await act(async () => { latest.current.enqueue([file("c")]); });
    await act(async () => { resolvers[0]?.({ ok: true, data: { data: {} } }); });
    await settle();
    expect(latest.current.progress).toEqual({ current: 2, total: 3 });

    await act(async () => { resolvers[1]?.({ ok: true, data: { data: {} } }); });
    await settle();
    await act(async () => { resolvers[2]?.({ ok: true, data: { data: {} } }); });
    await settle();
    expect(latest.current.progress).toBeNull();
  });

  it("keeps failures (including thrown errors) with a message, and retry re-uploads them", async () => {
    uploadMock
      .mockResolvedValueOnce({ ok: false, error: { message: "too big" } })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ ok: true, data: { data: {} } });
    const { latest, onUploaded } = await renderHook();

    await act(async () => { latest.current.enqueue([file("a"), file("b")]); });
    await settle();

    expect(latest.current.failed.map((item) => [item.file.name, item.error])).toEqual([
      ["a", "too big"],
      ["b", "fallback"],
    ]);
    expect(onUploaded).not.toHaveBeenCalled();

    const [first, second] = latest.current.failed;
    await act(async () => { latest.current.retry(first.id); });
    await settle();
    expect(latest.current.failed.map((item) => item.id)).toEqual([second.id]);
    expect(onUploaded).toHaveBeenCalledTimes(1);

    await act(async () => { latest.current.dismiss(second.id); });
    expect(latest.current.items).toEqual([]);
    expect(uploadMock).toHaveBeenCalledTimes(3);
  });
});
