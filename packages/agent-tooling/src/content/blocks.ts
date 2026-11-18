/**
 * The MCP content union we emit (MCP 2025-06-18) and the result shape both MCP
 * servers return from `tools/call`. Protocol code only: no I/O, no dependencies.
 */
export type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; mimeType: string; blob: string } }
  | { type: 'resource_link'; uri: string; name: string; mimeType?: string; size?: number; description?: string };

export interface ToolResult {
  content: McpContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
  /** Upstream HTTP status when the tool dispatched to /api/v1 (for audit granularity). */
  statusCode?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((k) => allowed.includes(k));
}

const isStr = (v: unknown): v is string => typeof v === 'string';

/**
 * Strict guard for the blocks we emit. Rejects unknown block types and unknown
 * keys so a block shape we did not design can never reach an MCP client.
 */
export function isMcpContentBlock(value: unknown): value is McpContentBlock {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'text':
      return onlyKeys(value, ['type', 'text']) && isStr(value.text);
    case 'image':
      return onlyKeys(value, ['type', 'data', 'mimeType']) && isStr(value.data) && isStr(value.mimeType);
    case 'resource': {
      const r = value.resource;
      return (
        onlyKeys(value, ['type', 'resource']) &&
        isRecord(r) &&
        onlyKeys(r, ['uri', 'mimeType', 'blob']) &&
        isStr(r.uri) &&
        isStr(r.mimeType) &&
        isStr(r.blob)
      );
    }
    case 'resource_link':
      return (
        onlyKeys(value, ['type', 'uri', 'name', 'mimeType', 'size', 'description']) &&
        isStr(value.uri) &&
        isStr(value.name) &&
        (value.mimeType === undefined || isStr(value.mimeType)) &&
        (value.size === undefined || (typeof value.size === 'number' && Number.isFinite(value.size))) &&
        (value.description === undefined || isStr(value.description))
      );
    default:
      return false;
  }
}

/** The one JSON-text result shape every non-attachment tool returns (pretty-printed, `null` for undefined). */
export function jsonToolResult(data: unknown, isError: boolean, statusCode?: number): ToolResult {
  const result: ToolResult = {
    content: [{ type: 'text', text: JSON.stringify(data ?? null, null, 2) }],
    isError,
  };
  if (statusCode !== undefined) result.statusCode = statusCode;
  return result;
}
