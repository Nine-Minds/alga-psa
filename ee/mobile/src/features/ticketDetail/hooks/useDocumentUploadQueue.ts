import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../../api";
import { uploadTicketDocument, type TicketDocumentUpload } from "../../../api/documents";
import { logger } from "../../../logging/logger";

export type UploadQueueItem = {
  id: string;
  file: TicketDocumentUpload;
  status: "pending" | "uploading" | "failed";
  error: string | null;
};

export type UploadQueueProgress = { current: number; total: number };

let nextItemId = 0;

/**
 * Sequential upload queue for ticket attachments. Files picked together (or
 * picked while an earlier upload is still running) are uploaded one after
 * another; successes drop off the queue, failures stay visible with retry.
 */
export function useDocumentUploadQueue({
  client,
  apiKey,
  ticketId,
  onUploaded,
  fallbackError,
}: {
  client: ApiClient | null;
  apiKey: string;
  ticketId: string;
  onUploaded: () => Promise<void> | void;
  fallbackError: string;
}) {
  const [items, setItems] = useState<UploadQueueItem[]>([]);
  const [progress, setProgress] = useState<UploadQueueProgress | null>(null);
  const itemsRef = useRef<UploadQueueItem[]>([]);
  const runningRef = useRef(false);
  const batchRef = useRef({ done: 0, total: 0 });
  const mountedRef = useRef(true);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  useEffect(() => () => { mountedRef.current = false; }, []);

  const commit = useCallback((next: UploadQueueItem[]) => {
    itemsRef.current = next;
    if (mountedRef.current) setItems(next);
  }, []);

  const patch = useCallback((id: string, changes: Partial<UploadQueueItem>) => {
    commit(itemsRef.current.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }, [commit]);

  const drain = useCallback(async () => {
    if (runningRef.current || !client || !apiKey) return;
    runningRef.current = true;
    try {
      let next = itemsRef.current.find((item) => item.status === "pending");
      while (next) {
        patch(next.id, { status: "uploading", error: null });
        if (mountedRef.current) setProgress({ current: batchRef.current.done + 1, total: batchRef.current.total });

        let error: string | null = null;
        try {
          const result = await uploadTicketDocument(client, { apiKey, ticketId, file: next.file });
          if (!result.ok) error = result.error.message || fallbackError;
        } catch (e) {
          logger.error("[useDocumentUploadQueue] upload threw", { error: e });
          error = fallbackError;
        }
        batchRef.current.done += 1;

        if (error) {
          patch(next.id, { status: "failed", error });
        } else {
          commit(itemsRef.current.filter((item) => item.id !== next!.id));
          await onUploadedRef.current();
        }
        next = itemsRef.current.find((item) => item.status === "pending");
      }
    } finally {
      runningRef.current = false;
      batchRef.current = { done: 0, total: 0 };
      if (mountedRef.current) setProgress(null);
    }
  }, [apiKey, client, commit, fallbackError, patch, ticketId]);

  const enqueue = useCallback((files: TicketDocumentUpload[]) => {
    if (files.length === 0) return;
    const added = files.map<UploadQueueItem>((file) => ({
      id: `upload-${++nextItemId}`,
      file,
      status: "pending",
      error: null,
    }));
    batchRef.current.total += added.length;
    commit([...itemsRef.current, ...added]);
    void drain();
  }, [commit, drain]);

  const retry = useCallback((id: string) => {
    const item = itemsRef.current.find((candidate) => candidate.id === id);
    if (!item || item.status !== "failed") return;
    batchRef.current.total += 1;
    patch(id, { status: "pending", error: null });
    void drain();
  }, [drain, patch]);

  const dismiss = useCallback((id: string) => {
    commit(itemsRef.current.filter((item) => item.id !== id));
  }, [commit]);

  return {
    items,
    progress,
    uploading: progress !== null,
    failed: items.filter((item) => item.status === "failed"),
    enqueue,
    retry,
    dismiss,
  };
}
