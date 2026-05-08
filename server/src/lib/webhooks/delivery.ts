import { Agent, fetch } from 'undici';
import { assertSafeWebhookTarget } from './ssrf';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_CAPTURED_BODY_CHARS = 8 * 1024;

export type WebhookDeliveryErrorType =
  | 'dns'
  | 'connect'
  | 'ssrf'
  | 'tls'
  | 'timeout'
  | 'unknown';

export interface WebhookDeliveryRequest {
  webhook_id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  payload: unknown;
  verify_ssl: boolean;
}

export interface WebhookDeliveryResult {
  success: boolean;
  status_code?: number;
  response_headers?: Record<string, string>;
  response_body?: string;
  error_message?: string;
  error_type?: WebhookDeliveryErrorType;
  duration_ms?: number;
}

function truncateBody(body: string): string {
  if (body.length <= MAX_CAPTURED_BODY_CHARS) {
    return body;
  }

  return body.slice(0, MAX_CAPTURED_BODY_CHARS);
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const normalized = { ...headers };
  const hasContentType = Object.keys(normalized).some(
    (key) => key.toLowerCase() === 'content-type',
  );

  if (!hasContentType) {
    normalized['content-type'] = 'application/json';
  }

  return normalized;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function classifyDeliveryError(error: unknown): WebhookDeliveryErrorType {
  const code = (error as { code?: string; cause?: { code?: string } })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code;
  const message = formatErrorMessage(error).toLowerCase();

  if (
    code === 'ABORT_ERR' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    message.includes('timeout') ||
    message.includes('timed out')
  ) {
    return 'timeout';
  }

  if (
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    message.includes('getaddrinfo') ||
    message.includes('dns')
  ) {
    return 'dns';
  }

  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    message.includes('connect')
  ) {
    return 'connect';
  }

  if (
    code === 'CERT_HAS_EXPIRED' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    message.includes('certificate') ||
    message.includes('tls') ||
    message.includes('ssl')
  ) {
    return 'tls';
  }

  return 'unknown';
}

export async function performWebhookDeliveryRequest(
  request: WebhookDeliveryRequest,
): Promise<WebhookDeliveryResult> {
  const startedAt = Date.now();
  const method = request.method.toUpperCase();
  const body =
    method === 'GET' || method === 'HEAD'
      ? undefined
      : JSON.stringify(request.payload ?? {});

  const dispatcher = request.verify_ssl
    ? undefined
    : new Agent({
        connect: {
          rejectUnauthorized: false,
        },
      });

  try {
    await assertSafeWebhookTarget(request.url);

    const response = await fetch(request.url, {
      method,
      headers: normalizeHeaders(request.headers),
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      dispatcher,
    });

    const responseBody = truncateBody(await response.text());

    return {
      success: response.ok,
      status_code: response.status,
      response_headers: Object.fromEntries(response.headers.entries()),
      response_body: responseBody,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    const errorType =
      error instanceof Error && error.name === 'UnsafeWebhookTargetError'
        ? 'ssrf'
        : classifyDeliveryError(error);

    return {
      success: false,
      error_message: formatErrorMessage(error),
      error_type: errorType,
      duration_ms: Date.now() - startedAt,
    };
  } finally {
    await dispatcher?.close();
  }
}
