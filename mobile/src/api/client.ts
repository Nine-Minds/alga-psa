import type { ApiRequest, ApiResult } from "./types";

type CreateApiClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
};

function buildUrl(
  baseUrl: string,
  path: string,
  query?: ApiRequest["query"],
): string {
  const url = new URL(path.replace(/^\//, ""), baseUrl.replace(/\/+$/, "") + "/");

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

async function readBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }

  try {
    return await response.text();
  } catch {
    return undefined;
  }
}

function mergeHeaders(
  headers?: Record<string, string | undefined>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  if (!headers) return merged;
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    merged[key] = value;
  }
  return merged;
}

export type ApiClient = {
  request<T>(req: ApiRequest): Promise<ApiResult<T>>;
};

export function createApiClient(options: CreateApiClientOptions): ApiClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  const baseUrl = options.baseUrl;

  return {
    async request<T>(req: ApiRequest): Promise<ApiResult<T>> {
      const url = buildUrl(baseUrl, req.path, req.query);
      const timeoutMs = req.timeoutMs ?? defaultTimeoutMs;

      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);

      const abortListener = () => abortController.abort();
      if (req.signal) {
        if (req.signal.aborted) {
          abortController.abort();
        } else {
          req.signal.addEventListener("abort", abortListener, { once: true });
        }
      }

      try {
        const response = await fetchImpl(url, {
          method: req.method,
          headers: mergeHeaders({
            accept: "application/json",
            ...(req.body === undefined ? {} : { "content-type": "application/json" }),
            ...req.headers,
          }),
          body: req.body === undefined ? undefined : JSON.stringify(req.body),
          signal: abortController.signal,
        });

        const body = await readBody(response);

        if (!response.ok) {
          return {
            ok: false,
            status: response.status,
            error: {
              kind: "http",
              status: response.status,
              message: `HTTP ${response.status}`,
              body,
            },
          };
        }

        return { ok: true, status: response.status, data: body as T };
      } catch (error) {
        if (abortController.signal.aborted) {
          return {
            ok: false,
            error: { kind: "timeout", message: "Request timed out", timeoutMs },
          };
        }

        return {
          ok: false,
          error: { kind: "network", message: "Network request failed", cause: error },
        };
      } finally {
        clearTimeout(timeoutHandle);
        if (req.signal) req.signal.removeEventListener("abort", abortListener);
      }
    },
  };
}
