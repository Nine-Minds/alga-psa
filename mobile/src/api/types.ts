export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type ApiError =
  | { kind: "network"; message: string; cause?: unknown }
  | { kind: "timeout"; message: string; timeoutMs: number }
  | { kind: "auth"; message: string; status: number; code?: string; body?: unknown }
  | { kind: "permission"; message: string; status: number; code?: string; body?: unknown }
  | { kind: "validation"; message: string; status: number; code?: string; details?: unknown; body?: unknown }
  | { kind: "server"; message: string; status: number; code?: string; body?: unknown }
  | { kind: "http"; message: string; status: number; code?: string; body?: unknown }
  | { kind: "parse"; message: string; bodyText?: string };

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status?: number; error: ApiError };

export type ApiRequest = {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
};
