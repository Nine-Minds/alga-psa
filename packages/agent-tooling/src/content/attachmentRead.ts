import { isMcpContentBlock, jsonToolResult, type McpContentBlock, type ToolResult } from './blocks';

/**
 * Header of a `read_attachment` result. Always `content[0]` and also sent as
 * `structuredContent`; the audit summary depends on that.
 */
export interface AttachmentReadHeader {
  entity: { type: string; id: string; label?: string | null };
  served: Array<Record<string, unknown>>;
  omitted: Array<Record<string, unknown>>;
  limits_applied: string[];
  remaining: string | null;
  next_cursor: string | null;
  instructions: string;
  [key: string]: unknown;
}

/** Wire contract of `GET /api/v1/documents/content`. */
export interface AttachmentReadPayload {
  header: AttachmentReadHeader;
  blocks: McpContentBlock[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Map the endpoint response onto an MCP tool result: the header first, then the
 * blocks. Every block is validated; an unrecognised block is dropped and counted
 * in the header, so an unknown shape can never reach a client. A non-2xx status
 * or a malformed payload becomes a JSON error result.
 */
export function attachmentReadToToolResult(payload: unknown, status: number): ToolResult {
  const ok = status >= 200 && status < 300;
  const body = isRecord(payload) && isRecord(payload.data) && 'header' in payload.data ? payload.data : payload;
  if (!ok || !isRecord(body) || !isRecord(body.header) || !Array.isArray(body.blocks)) {
    return jsonToolResult({ status, ok: false, data: payload }, true, status);
  }
  const header: Record<string, unknown> = { ...body.header };
  const blocks: McpContentBlock[] = [];
  let dropped = 0;
  for (const block of body.blocks as unknown[]) {
    if (isMcpContentBlock(block)) blocks.push(block);
    else dropped += 1;
  }
  if (dropped > 0) header.dropped_blocks = dropped;
  return {
    content: [{ type: 'text', text: JSON.stringify(header) }, ...blocks],
    structuredContent: header,
    isError: false,
    statusCode: status,
  };
}
