export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVELS: Record<Exclude<LogLevel, "silent">, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function parseLogLevel(value: unknown): LogLevel {
  if (typeof value !== "string") return __DEV__ ? "debug" : "info";
  const normalized = value.trim().toLowerCase();
  if (normalized === "silent") return "silent";
  if (normalized in LEVELS) return normalized as Exclude<LogLevel, "silent">;
  return __DEV__ ? "debug" : "info";
}

const currentLevel = parseLogLevel(process.env.EXPO_PUBLIC_LOG_LEVEL);

const REDACTED = "[REDACTED]";
const REDACT_KEYS = new Set([
  "authorization",
  "token",
  "accessToken",
  "refreshToken",
  "idToken",
  "password",
  "secret",
  "apiKey",
  "cookie",
  "set-cookie",
]);

function redactString(value: string): string {
  let out = value;
  out = out.replace(/Bearer\\s+[^\\s]+/gi, `Bearer ${REDACTED}`);
  out = out.replace(/refresh[_-]?token\\s*[:=]\\s*[^\\s]+/gi, `refresh_token=${REDACTED}`);
  out = out.replace(/access[_-]?token\\s*[:=]\\s*[^\\s]+/gi, `access_token=${REDACTED}`);
  return out;
}

function redactAny(value: unknown, depth: number): unknown {
  if (depth <= 0) return value;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((v) => redactAny(v, depth - 1));
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(obj)) {
      out[key] = REDACT_KEYS.has(key) ? REDACTED : redactAny(v, depth - 1);
    }
    return out;
  }
  return value;
}

export function redact<T>(value: T): T {
  return redactAny(value, 6) as T;
}

function shouldLog(level: Exclude<LogLevel, "silent">): boolean {
  if (currentLevel === "silent") return false;
  return LEVELS[level] >= LEVELS[currentLevel as Exclude<LogLevel, "silent">];
}

export const logger = {
  debug(message: string, meta?: unknown) {
    if (!shouldLog("debug")) return;
    console.debug(message, meta === undefined ? undefined : redact(meta));
  },
  info(message: string, meta?: unknown) {
    if (!shouldLog("info")) return;
    console.info(message, meta === undefined ? undefined : redact(meta));
  },
  warn(message: string, meta?: unknown) {
    if (!shouldLog("warn")) return;
    console.warn(message, meta === undefined ? undefined : redact(meta));
  },
  error(message: string, meta?: unknown) {
    if (!shouldLog("error")) return;
    console.error(message, meta === undefined ? undefined : redact(meta));
  },
};

