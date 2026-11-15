/**
 * Built-in download hosts for URL document sources.
 *
 * These live in code, not in a per-tenant table: a host change by the provider is fixed
 * for every tenant in one release. A tenant can switch a built-in entry off
 * (`document_fetch_hosts` row of kind `builtin_disabled`) and add its own hosts
 * (kind `custom`). Effective allowlist = enabled built-ins ∪ custom entries.
 *
 * Plan: ee/docs/plans/2026-10-20-mcp-doc-attachments.md §5.
 */

export interface BuiltinFetchHost {
  /** Exact hostname, or a narrow `*.label.domain` pattern. */
  pattern: string;
  /** Short human description shown in Settings > MCP Server. */
  label: string;
}

export const BUILTIN_FETCH_HOSTS: readonly BuiltinFetchHost[] = [
  {
    // UNCONFIRMED: taken from field reports of ChatGPT connector `download_url` values
    // (openai-apps-sdk-examples #185/#237), NOT from a live ChatGPT connector call and not
    // from OpenAI documentation, which says only that the URL is "temporary". Confirm with a
    // real ChatGPT call before merge; if the real host differs or is a family of hosts,
    // correct this entry (exact hosts preferred, a narrow `*.label.domain` only if the real
    // host varies). Until then ChatGPT attachments can fail with FETCH_HOST_NOT_ALLOWED, and
    // an admin can add the real host as a custom entry.
    pattern: 'files.oaiusercontent.com',
    label: 'ChatGPT file attachments',
  },
];

export function isBuiltinFetchHost(pattern: string): boolean {
  return BUILTIN_FETCH_HOSTS.some((h) => h.pattern === pattern);
}
