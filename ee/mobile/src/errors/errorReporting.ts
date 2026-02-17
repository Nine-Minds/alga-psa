import { logger, redact } from "../logging/logger";

function omitHttpBodies(value: unknown, depth: number = 0): unknown {
  if (depth > 6) return "[omitted]";

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: omitHttpBodies((value as unknown as { cause?: unknown }).cause, depth + 1),
    };
  }

  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => omitHttpBodies(item, depth + 1));

  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    const lower = key.toLowerCase();

    const isBodyField =
      lower === "body" ||
      lower === "requestbody" ||
      lower === "responsebody" ||
      lower.endsWith("_body") ||
      lower.endsWith("body");

    if (isBodyField) {
      out[key] = "[omitted]";
      continue;
    }

    out[key] = omitHttpBodies(child, depth + 1);
  }

  return out;
}

export function buildErrorReportPayload(error: unknown, context?: Record<string, unknown>) {
  return {
    error: omitHttpBodies(error),
    context: context ? (omitHttpBodies(context) as Record<string, unknown>) : undefined,
  };
}

export function reportError(error: unknown, context?: Record<string, unknown>) {
  logger.error("app.error", redact(buildErrorReportPayload(error, context)));
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
