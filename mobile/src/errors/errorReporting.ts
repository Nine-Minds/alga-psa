import { logger, redact } from "../logging/logger";

export function reportError(error: unknown, context?: Record<string, unknown>) {
  logger.error("app.error", redact({ error, context }));
}

export function installGlobalErrorHandler() {
  const errorUtils = (globalThis as unknown as { ErrorUtils?: unknown }).ErrorUtils as
    | { getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void; setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void }
    | undefined;

  const prev = errorUtils?.getGlobalHandler?.();
  errorUtils?.setGlobalHandler?.((error, isFatal) => {
    reportError(error, { isFatal });
    prev?.(error, isFatal);
  });
}

