'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  UploadSessionClientError,
  uploadFileInSession,
  type UploadFailureReason,
  type UploadTarget,
  type UploadedDocument,
} from '../lib/uploadSessionClient';

export type UploadItemStatus = 'pending' | 'uploading' | 'success' | 'error' | 'cancelled';

export interface UploadItem {
  file: File;
  status: UploadItemStatus;
  /** Bytes the server has committed. */
  committed: number;
  failure?: { reason: UploadFailureReason; message: string; maxFileSize?: number };
  document?: UploadedDocument;
}

export interface UploadOutcome {
  file: File;
  status: 'success' | 'error' | 'cancelled';
  failure?: UploadItem['failure'];
  document?: UploadedDocument;
}

/**
 * React state for a batch of uploads through the session API: files go one at a time, each with
 * its own committed-byte progress, and any of them can be cancelled. Unmounting cancels whatever
 * is still running, so no session is left active.
 */
export function useDocumentUploads() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const controllers = useRef(new Map<number, AbortController>());
  const cancelledIndexes = useRef(new Set<number>());

  useEffect(() => {
    const running = controllers.current;
    return () => running.forEach((controller) => controller.abort());
  }, []);

  const patch = useCallback((index: number, change: Partial<UploadItem>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...change } : item)));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  /** Aborts the request in flight and deletes the session; a file still waiting is simply skipped. */
  const cancel = useCallback((index: number) => {
    cancelledIndexes.current.add(index);
    const controller = controllers.current.get(index);
    if (controller) {
      controller.abort();
    } else {
      setItems((prev) => prev.map((item, i) =>
        i === index && item.status === 'pending' ? { ...item, status: 'cancelled' } : item));
    }
  }, []);

  /** Replaces the previous batch and resolves with one terminal outcome per file. */
  const uploadBatch = useCallback(async (
    files: File[],
    target: UploadTarget,
    onFileUploaded?: (document: UploadedDocument) => Promise<void>,
    shouldSkip?: (file: File) => boolean,
  ): Promise<UploadOutcome[]> => {
    controllers.current.clear();
    cancelledIndexes.current.clear();
    setItems(files.map((file) => ({ file, status: 'pending', committed: 0 })));
    const outcomes: UploadOutcome[] = [];

    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      if (cancelledIndexes.current.has(index) || shouldSkip?.(file)) {
        outcomes.push({ file, status: 'cancelled' });
        patch(index, { status: 'cancelled' });
        continue;
      }
      const controller = new AbortController();
      controllers.current.set(index, controller);
      patch(index, { status: 'uploading' });
      let outcome: UploadOutcome;
      try {
        const document = await uploadFileInSession({
          file,
          target,
          signal: controller.signal,
          onProgress: ({ committed }) => patch(index, { committed }),
        });
        outcome = { file, status: 'success', document };
      } catch (error) {
        if (error instanceof UploadSessionClientError) {
          outcome = error.reason === 'cancelled'
            ? { file, status: 'cancelled' }
            : { file, status: 'error', failure: { reason: error.reason, message: error.message, maxFileSize: error.details.maxFileSize } };
        } else {
          console.error('Unexpected upload failure:', error);
          outcome = { file, status: 'error', failure: { reason: 'unknown', message: error instanceof Error ? error.message : String(error) } };
        }
      } finally {
        controllers.current.delete(index);
      }
      patch(index, {
        status: outcome.status,
        failure: outcome.failure,
        document: outcome.document,
        ...(outcome.status === 'success' ? { committed: file.size } : {}),
      });
      outcomes.push(outcome);
      if (outcome.status === 'success' && outcome.document) {
        await onFileUploaded?.(outcome.document);
      }
    }
    return outcomes;
  }, [patch]);

  return { items, uploadBatch, cancel, clear };
}
