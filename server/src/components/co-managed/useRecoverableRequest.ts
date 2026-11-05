'use client';

import { useCallback, useState } from 'react';

/** True when every field the form edits still holds the value that was sent. */
function sameDetails<Draft extends object>(request: Draft, draft: Draft): boolean {
  return (Object.keys(draft) as Array<keyof Draft>).every(key => JSON.stringify(request[key]) === JSON.stringify(draft[key]));
}

/**
 * The submission lifecycle of an idempotent create whose response can be lost after the server has already acted:
 *
 *   editing --send--> in flight --acknowledged (success or rejection)--> editing
 *                               \-no response---------------------------> unconfirmed
 *
 * An unconfirmed request may have executed, so it is retained exactly. While the form still holds its details the
 * submission is a Retry: it resends that identical request (same operation ID) and the server answers with the
 * original outcome. Editing the details makes the next submission a new request built by the caller (callers keep
 * the operation ID, so the server refuses a changed request as a conflict instead of creating a second record).
 */
export function useRecoverableRequest<Draft extends object, Request extends Draft>(draft: Draft) {
  const [unconfirmed, setUnconfirmed] = useState<Request | null>(null);
  const retrying = unconfirmed !== null && sameDetails(unconfirmed, draft);

  /** Sends the retained request when retrying, otherwise `build()`. A throw means the outcome is unknown. */
  const send = async <Result,>(build: () => Request, action: (request: Request) => Promise<Result>): Promise<Result> => {
    const request = retrying && unconfirmed ? unconfirmed : build();
    try {
      const result = await action(request);
      setUnconfirmed(null);
      return result;
    } catch (error) {
      setUnconfirmed(request);
      throw error;
    }
  };
  const reset = useCallback(() => setUnconfirmed(null), []);

  return { retrying, unconfirmed: unconfirmed !== null, send, reset };
}
