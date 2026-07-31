type QboConnectionChangeHandler = (tenantId: string) => Promise<void> | void;

const HANDLER_KEY = Symbol.for('alga.integrations.qboConnectionChangeHandler');

type HandlerRegistry = typeof globalThis & {
  [HANDLER_KEY]?: QboConnectionChangeHandler | null;
};

// Lets the server converge the accounting-sync schedule when a tenant connects
// or disconnects QuickBooks, without this package depending on server code.
// The server registers the handler at startup (see initializeApp). Mirrors the
// workflow-schedule job-runner provider seam.
export function registerQboConnectionChangeHandler(handler: QboConnectionChangeHandler): void {
  (globalThis as HandlerRegistry)[HANDLER_KEY] = handler;
}

// Fire-and-forget: notify that a tenant's QBO connection state changed. No-op
// until a handler is registered, and never throws into the caller (connect /
// disconnect must not fail because schedule convergence did).
export async function notifyQboConnectionChanged(tenantId: string): Promise<void> {
  const handler = (globalThis as HandlerRegistry)[HANDLER_KEY];
  if (!handler) return;
  try {
    await handler(tenantId);
  } catch {
    // best-effort
  }
}
