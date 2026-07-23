import { useCallback, useState } from "react";
import { useAppResume } from "../../../hooks/useAppResume";

export type PendingCall = {
  opportunityId: string;
  contactName: string | null;
  contactId: string | null;
  clientId: string | null;
  startedAtMs: number;
};

export type PendingCallPrompt = {
  contactName: string | null;
  contactId: string | null;
  clientId: string | null;
  durationMinutes: number;
};

// A call launched from the detail screen sends the user to the phone app. We only
// surface a "log this call?" prompt on the way back if they return reasonably soon.
const PENDING_CALL_WINDOW_MS = 4 * 60 * 60 * 1000;

// Module-level so it survives the app going to the background (component state does not).
let pendingCall: PendingCall | null = null;

export function recordPendingCall(call: PendingCall): void {
  pendingCall = call;
}

export function clearPendingCall(): void {
  pendingCall = null;
}

/**
 * On app resume, if a pending call was recorded for this deal within the window,
 * expose a one-shot prompt (with the elapsed duration) and clear the record so it
 * never fires twice. Never auto-logs — the caller decides what to do with it.
 */
export function usePendingCallPrompt(opportunityId: string): {
  prompt: PendingCallPrompt | null;
  dismiss: () => void;
} {
  const [prompt, setPrompt] = useState<PendingCallPrompt | null>(null);

  const check = useCallback(() => {
    const pending = pendingCall;
    if (!pending || pending.opportunityId !== opportunityId) return;

    const elapsed = Date.now() - pending.startedAtMs;
    pendingCall = null; // consume regardless of whether it is still fresh
    if (elapsed < 0 || elapsed >= PENDING_CALL_WINDOW_MS) return;

    setPrompt({
      contactName: pending.contactName,
      contactId: pending.contactId,
      clientId: pending.clientId,
      durationMinutes: Math.max(1, Math.ceil(elapsed / 60000)),
    });
  }, [opportunityId]);

  useAppResume(check);

  const dismiss = useCallback(() => setPrompt(null), []);

  return { prompt, dismiss };
}
