/**
 * Browser client for the resumable upload API (`/api/documents/uploads`). No React, no DOM beyond
 * `fetch`/`AbortSignal`, so any entry point (the document uploader, comment attachments, ...) can
 * drive a file through it and a test can drive it with a fake `fetch`.
 *
 * One file: create a session, PUT its chunks one at a time at the server's `chunkSize`, complete.
 * The committed offset the server reports is the only source of truth for progress and resume.
 * A failed chunk is retried with exponential backoff; before each retry a HEAD asks the server how
 * much it really holds, so committed bytes are never sent twice and bytes the server committed
 * after the client lost the response are not sent again either.
 */

export const UPLOADS_PATH = '/api/documents/uploads';

/**
 * Retry policy for a failed chunk (and for complete): capped exponential backoff with jitter,
 * 1 s, 2 s, 4 s, 8 s, then 15 s, until the scheduled waits add up to `RETRY_WINDOW_MS`. Jitter
 * scales each wait to 75-100 %, so an outage of about a minute is always ridden out. Time spent
 * offline (see `UploadTransport.waitForOnline`) never uses up the window.
 */
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_CAP_MS = 15_000;
export const RETRY_WINDOW_MS = 90_000;

const scheduledBackoffMs = (attempt: number) => Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));

/** Why an upload stopped; each value has its own message in the UI. */
export type UploadFailureReason =
  | 'tooLarge' // 413 UPLOAD_TOO_LARGE; `maxFileSize` is set
  | 'typeNotAllowed' // 415 UPLOAD_TYPE_NOT_ALLOWED / UPLOAD_TYPE_REJECTED
  | 'permissionDenied' // 401 / 403
  | 'sessionGone' // 404 / 410: the session expired, was aborted or never existed; start again
  | 'network' // no response, or a 5xx / busy answer, on every retry
  | 'cancelled' // the caller aborted
  | 'unknown';

export class UploadSessionClientError extends Error {
  constructor(
    readonly reason: UploadFailureReason,
    message: string,
    readonly details: { status?: number; code?: string; maxFileSize?: number } = {},
  ) {
    super(message);
    this.name = 'UploadSessionClientError';
  }
}

/** A failure that a retry (after asking the server for its offset) can fix. */
const RETRYABLE_CODES = new Set(['OFFSET_MISMATCH', 'CHUNK_IN_PROGRESS', 'COMPLETE_IN_PROGRESS']);

interface ApiError {
  status: number;
  code?: string;
  message: string;
  maxFileSize?: number;
}

/** The reason a refusal maps to, or null when it is only worth retrying. */
export function reasonForApiError(status: number, code?: string): UploadFailureReason | null {
  if (code === 'UPLOAD_TOO_LARGE' || (status === 413 && code === undefined)) return 'tooLarge';
  if (code === 'UPLOAD_TYPE_NOT_ALLOWED' || code === 'UPLOAD_TYPE_REJECTED' || status === 415) return 'typeNotAllowed';
  if (status === 401 || status === 403 || code === 'UNAUTHORIZED' || code === 'FORBIDDEN') return 'permissionDenied';
  if (status === 404 || status === 410 || code === 'UPLOAD_NOT_FOUND' || code === 'UPLOAD_EXPIRED' || code === 'UPLOAD_ABORTED') {
    return 'sessionGone';
  }
  if (status >= 500 || (code !== undefined && RETRYABLE_CODES.has(code))) return null;
  return 'unknown';
}

/** Internal: a failure that a retry may fix. Never leaves this module. */
class RetryableFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableFailure';
  }
}

export interface UploadTarget {
  /** Omit both for a document with no target. */
  entityType?: string;
  entityId?: string;
  folderPath?: string | null;
}

export interface UploadedDocument {
  document_id: string;
  file_id: string | null;
  document_name: string;
  mime_type: string;
  file_size: number;
}

export interface UploadProgress {
  /** Bytes the server has durably committed. */
  committed: number;
  total: number;
}

export interface UploadTransport {
  fetch: typeof fetch;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Jitter factor in [0, 1). */
  random: () => number;
  /**
   * Resolves `false` at once when the browser is online. When it is offline, waits for it to come
   * back and resolves `true`. Rejects as cancelled if `signal` aborts meanwhile.
   */
  waitForOnline: (signal?: AbortSignal) => Promise<boolean>;
}

async function waitForBrowserOnline(signal?: AbortSignal): Promise<boolean> {
  if (typeof navigator === 'undefined' || navigator.onLine !== false || typeof window === 'undefined') return false;
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    const onOnline = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      window.removeEventListener('online', onOnline);
      reject(cancelled());
    };
    window.addEventListener('online', onOnline, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  return true;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const cancelled = () => new UploadSessionClientError('cancelled', 'Upload cancelled');

export interface UploadFileInput {
  file: File;
  target?: UploadTarget;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
  transport?: Partial<UploadTransport>;
}

async function readApiError(response: Response): Promise<ApiError> {
  let code: string | undefined;
  let message = response.statusText || `HTTP ${response.status}`;
  let maxFileSize: number | undefined;
  try {
    const body = await response.json();
    if (body?.error) {
      code = typeof body.error.code === 'string' ? body.error.code : undefined;
      if (typeof body.error.message === 'string') message = body.error.message;
      if (typeof body.error.maxFileSize === 'number') maxFileSize = body.error.maxFileSize;
    }
  } catch {
    // HEAD responses and proxy error pages have no JSON body.
  }
  return { status: response.status, code, message, maxFileSize };
}

function parseOffset(response: Response): number | null {
  const raw = response.headers.get('Upload-Offset');
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Throws a terminal error, or `RetryableFailure` when a retry may fix it. */
async function failFromResponse(response: Response): Promise<never> {
  const error = await readApiError(response);
  const reason = reasonForApiError(error.status, error.code);
  if (reason === null) throw new RetryableFailure(error.message);
  throw new UploadSessionClientError(reason, error.message, {
    status: error.status,
    code: error.code,
    maxFileSize: error.maxFileSize,
  });
}

export async function uploadFileInSession(input: UploadFileInput): Promise<UploadedDocument> {
  const { file, target, signal, onProgress } = input;
  const http: UploadTransport = {
    fetch: input.transport?.fetch ?? ((url, init) => fetch(url, init)),
    sleep: input.transport?.sleep ?? abortableSleep,
    random: input.transport?.random ?? Math.random,
    waitForOnline: input.transport?.waitForOnline ?? waitForBrowserOnline,
  };
  const total = file.size;

  // A caller abort may surface as an AbortError from fetch; it is always reported as `cancelled`.
  const call = async (url: string, init: RequestInit): Promise<Response> => {
    if (signal?.aborted) throw cancelled();
    try {
      return await http.fetch(url, { ...init, signal, credentials: 'same-origin' });
    } catch (error) {
      if (signal?.aborted) throw cancelled();
      throw new RetryableFailure(error instanceof Error ? error.message : 'Network error');
    }
  };

  // --- create: not retried (a lost response could leave an unreachable session behind) ---
  let created: { sessionId: string; chunkSize: number; maxFileSize: number };
  try {
    const response = await call(UPLOADS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: total,
        ...(target?.entityType && target.entityId ? { entityType: target.entityType, entityId: target.entityId } : {}),
        ...(target?.folderPath !== undefined && target.folderPath !== null ? { folderPath: target.folderPath } : {}),
      }),
    });
    if (response.status !== 201) await failFromResponse(response);
    created = await response.json();
  } catch (error) {
    if (error instanceof RetryableFailure) {
      throw new UploadSessionClientError('network', error.message);
    }
    throw error;
  }
  const sessionUrl = `${UPLOADS_PATH}/${created.sessionId}`;
  let sessionOpen = true;

  const abortSession = async () => {
    // Best effort, and deliberately not tied to the caller's signal (that one has just fired).
    try {
      await http.fetch(sessionUrl, { method: 'DELETE', credentials: 'same-origin' });
    } catch {
      // The server expires the session on its own.
    }
  };

  const withRetries = async <T>(operation: () => Promise<T>, beforeRetry?: () => Promise<void>): Promise<T> => {
    let attempts = 0;
    let scheduled = 0;
    for (;;) {
      try {
        return await operation();
      } catch (error) {
        if (!(error instanceof RetryableFailure)) throw error;
        // Every failure, including a failed offset check, is followed by a wait and a HEAD.
        for (;;) {
          // A failure while offline says nothing about the server: wait for the network, and
          // neither count it nor back off.
          const wasOffline = await http.waitForOnline(signal);
          if (!wasOffline) {
            attempts += 1;
            const wait = scheduledBackoffMs(attempts);
            scheduled += wait;
            if (scheduled > RETRY_WINDOW_MS) {
              throw new UploadSessionClientError('network', error instanceof Error ? error.message : 'Upload interrupted');
            }
            await http.sleep(Math.round(wait * (0.75 + 0.25 * http.random())), signal);
          }
          try {
            await beforeRetry?.();
            break;
          } catch (checkError) {
            if (!(checkError instanceof RetryableFailure)) throw checkError;
          }
        }
      }
    }
  };

  try {
    let offset = 0;
    const report = () => onProgress?.({ committed: offset, total });
    report();

    /** The server's committed offset, which wins over whatever the client last saw. */
    const syncOffset = async () => {
      const response = await call(sessionUrl, { method: 'HEAD' });
      if (!response.ok) await failFromResponse(response);
      const committed = parseOffset(response);
      if (committed === null) throw new RetryableFailure('Missing Upload-Offset');
      offset = committed;
      report();
    };

    while (offset < total) {
      await withRetries(async () => {
        const start = offset;
        const end = Math.min(start + created.chunkSize, total) - 1;
        const response = await call(sessionUrl, {
          method: 'PUT',
          headers: { 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Type': 'application/octet-stream' },
          body: file.slice(start, end + 1),
        });
        if (!response.ok) await failFromResponse(response);
        const committed = parseOffset(response);
        if (committed === null) throw new UploadSessionClientError('unknown', 'Upload response had no Upload-Offset');
        offset = committed;
        report();
      }, syncOffset);
    }

    const completed = await withRetries(async () => {
      const response = await call(`${sessionUrl}/complete`, { method: 'POST' });
      if (!response.ok) await failFromResponse(response);
      return (await response.json()).document as UploadedDocument;
    });
    sessionOpen = false;
    return completed;
  } catch (error) {
    // Any way out except success frees the session now, so none is left active until it expires.
    // A session the server already ended needs no DELETE.
    const gone = error instanceof UploadSessionClientError && error.reason === 'sessionGone';
    if (sessionOpen && !gone) await abortSession();
    throw error;
  }
}
