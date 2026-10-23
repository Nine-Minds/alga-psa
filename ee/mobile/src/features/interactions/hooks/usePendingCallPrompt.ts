import { useCallback, useEffect, useState } from "react";
import { useAppResume } from "../../../hooks/useAppResume";

/** The screen a call was placed from; the prompt only surfaces there. */
export type CallOrigin = {
  kind: "opportunity" | "contact" | "client" | "ticket";
  id: string;
};

export type PendingCall = {
  origin: CallOrigin;
  phone: string;
  /** Who was called, for the prompt copy: the contact, else the client. */
  name: string | null;
  contactId: string | null;
  clientId: string | null;
  ticketId?: string | null;
  opportunityId?: string | null;
  startedAtMs: number;
};

export type PendingCallPrompt = Omit<PendingCall, "origin" | "startedAtMs"> & {
  durationMinutes: number;
};

// A call sends the user to the phone app. We only surface a "log this call?"
// prompt on the way back if they return reasonably soon.
const PENDING_CALL_WINDOW_MS = 4 * 60 * 60 * 1000;

// Module-level so it survives the app going to the background (component state does not).
let pendingCall: PendingCall | null = null;

export function recordPendingCall(call: PendingCall): void {
  pendingCall = call;
}

export function clearPendingCall(): void {
  pendingCall = null;
}

function sameOrigin(a: CallOrigin, b: CallOrigin): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/**
 * When the originating screen comes back (app resume, or a remount after the
 * biometric lock replaced the navigator), consume the pending call and expose a
 * one-shot prompt with the elapsed duration. Never auto-logs.
 */
export function usePendingCallPrompt(origin: CallOrigin): {
  prompt: PendingCallPrompt | null;
  dismiss: () => void;
} {
  const [prompt, setPrompt] = useState<PendingCallPrompt | null>(null);

  const check = useCallback(() => {
    const pending = pendingCall;
    if (!pending || !sameOrigin(pending.origin, origin)) return;

    const elapsed = Date.now() - pending.startedAtMs;
    pendingCall = null; // consume regardless of whether it is still fresh
    if (elapsed < 0 || elapsed >= PENDING_CALL_WINDOW_MS) return;

    setPrompt({
      phone: pending.phone,
      name: pending.name,
      contactId: pending.contactId,
      clientId: pending.clientId,
      ticketId: pending.ticketId,
      opportunityId: pending.opportunityId,
      durationMinutes: Math.max(1, Math.ceil(elapsed / 60000)),
    });
  }, [origin.id, origin.kind]);

  useAppResume(check);
  useEffect(check, [check]);

  const dismiss = useCallback(() => setPrompt(null), []);

  return { prompt, dismiss };
}
