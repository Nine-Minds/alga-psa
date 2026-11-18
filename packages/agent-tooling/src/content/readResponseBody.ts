/** An upstream HTTP body, decoded by its Content-Type. Binary bodies are never decoded. */
export type UpstreamBody =
  | { kind: 'json'; value: unknown }
  | { kind: 'text'; value: string }
  | { kind: 'binary'; contentType: string; byteLength: number | null; fileName: string | null };

export const BINARY_BODY_HINT =
  'Binary content is not returned by call_api_endpoint. Use read_attachment to read ticket attachments.';

function mediaType(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase();
}

function isJsonType(mt: string): boolean {
  return mt === 'application/json' || mt.endsWith('+json');
}

function isTextType(mt: string): boolean {
  return mt.startsWith('text/') || mt === 'application/xml' || mt.endsWith('+xml');
}

function fileNameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = /filename\*\s*=\s*(?:[\w-]+'[^']*')?([^;]+)/i.exec(disposition);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(disposition);
  if (!plain) return null;
  return (plain[2] ?? plain[1]).trim() || null;
}

/**
 * Releases a body we will not read. Best-effort and deliberately not awaited: the cancel promise of a
 * teed stream settles only once every branch is cancelled, and Next.js' patched server fetch hands
 * out such a branch, so awaiting it hung the hosted server's binary call_api_endpoint forever.
 */
function releaseBody(res: Response): void {
  try {
    res.body?.cancel().catch(() => undefined);
  } catch {
    /* nothing to release */
  }
}

async function readText(res: Response): Promise<string> {
  return res.text().catch(() => '');
}

/**
 * Replaces `res.text()` at both upstream-read sites. Dispatches on Content-Type:
 * JSON is parsed (malformed JSON falls back to text), text types are read as text,
 * a response with no Content-Type keeps the historical behaviour (read as text,
 * parsed when it is JSON), and everything else is `binary`: the body is cancelled
 * and never decoded.
 */
export async function readResponseBody(res: Response): Promise<UpstreamBody> {
  const contentType = res.headers?.get?.('content-type') ?? '';
  const mt = mediaType(contentType);

  if (mt === '' || isJsonType(mt) || isTextType(mt)) {
    const text = await readText(res);
    if (text && (mt === '' || isJsonType(mt))) {
      try {
        return { kind: 'json', value: JSON.parse(text) };
      } catch {
        return { kind: 'text', value: text };
      }
    }
    return { kind: 'text', value: text };
  }

  releaseBody(res);
  const length = res.headers?.get?.('content-length');
  const parsed = length !== null && length !== undefined && length !== '' ? Number(length) : NaN;
  return {
    kind: 'binary',
    contentType: contentType || mt,
    byteLength: Number.isFinite(parsed) ? parsed : null,
    fileName: fileNameFromDisposition(res.headers?.get?.('content-disposition') ?? null),
  };
}

/** What the model sees in place of a binary body. */
export function describeBinaryBody(body: Extract<UpstreamBody, { kind: 'binary' }>): Record<string, unknown> {
  return {
    binary: true,
    content_type: body.contentType,
    byte_length: body.byteLength,
    file_name: body.fileName,
    hint: BINARY_BODY_HINT,
  };
}

/** The value a JSON-text tool result carries for an upstream body (today's `data`). */
export function upstreamBodyData(body: UpstreamBody): unknown {
  return body.kind === 'binary' ? describeBinaryBody(body) : body.value;
}
