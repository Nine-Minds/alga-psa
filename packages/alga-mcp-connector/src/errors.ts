/**
 * Turn an HTTP failure into an actionable, model-readable message. 401/403 get
 * a clear "reconfigure your token" hint; other statuses include a body snippet.
 */
export function describeHttpFailure(status: number, statusText: string, bodyText: string): string {
  if (status === 401 || status === 403) {
    return (
      `Authentication failed (HTTP ${status}). Your ALGA_API_TOKEN may be invalid, expired, ` +
      'or lack permission for this operation. Reconfigure ALGA_API_TOKEN in your MCP client config.'
    );
  }
  const snippet = bodyText && bodyText.length > 0 ? ` — ${bodyText.slice(0, 500)}` : '';
  return `Request failed with HTTP ${status} ${statusText}${snippet}`;
}
