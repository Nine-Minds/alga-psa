export type AccountingConnectionChangeHandler = (tenantId: string) => Promise<void> | void;

const HANDLER_KEY = Symbol.for('alga.integrations.accountingConnectionChangeHandler');

type HandlerRegistry = typeof globalThis & {
  [HANDLER_KEY]?: AccountingConnectionChangeHandler | null;
};

// Lets provider packages ask the server to converge the recurring accounting
// sync schedule without importing server job code. The server registers this
// seam during startup; QBO and Xero both notify it after durable connection
// changes.
export function registerAccountingConnectionChangeHandler(handler: AccountingConnectionChangeHandler): void {
  (globalThis as HandlerRegistry)[HANDLER_KEY] = handler;
}

// Connection persistence must not fail merely because schedule convergence
// fails. Startup reconciliation remains the backstop, while this notification
// makes connect/disconnect changes take effect immediately in a live process.
export async function notifyAccountingConnectionChanged(tenantId: string): Promise<void> {
  const handler = (globalThis as HandlerRegistry)[HANDLER_KEY];
  if (!handler) return;
  try {
    await handler(tenantId);
  } catch {
    // best-effort
  }
}
