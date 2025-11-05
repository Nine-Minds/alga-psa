/**
 * Shared builder for extension UI iframe src URLs.
 * Enforces content hash format and handles RUNNER_PUBLIC_BASE when EXT_UI_HOST_MODE === "rust".
 *
 * Example:
 *   const src = buildExtUiSrc("ext-123", "sha256:...64hex...", "/");
 *   <iframe src={src} sandbox="allow-scripts"></iframe>
 */
export function buildExtUiSrc(
  extensionId: string,
  contentHash: string,
  clientPath: string,
  opts?: { tenantId?: string; publicBaseOverride?: string }
): string {
  if (!/^sha256:[0-9a-f]{64}$/i.test(contentHash)) {
    throw new Error("Invalid content hash; expected format 'sha256:<hex64>'");
  }

  const mode = (process.env.EXT_UI_HOST_MODE || 'rust').toLowerCase();
  const overrideBase = normalizePublicBase(opts?.publicBaseOverride);
  const publicBase =
    overrideBase ?? (mode === 'rust' ? normalizePublicBase(process.env.RUNNER_PUBLIC_BASE) : null);

  const params = new URLSearchParams({ path: clientPath || '/' });
  if (opts?.tenantId) {
    params.set('tenant', opts.tenantId);
  }
  params.set('extensionId', extensionId);
  const qs = params.toString();
  const suffix = `/ext-ui/${encodeURIComponent(extensionId)}/${encodeURIComponent(contentHash)}/index.html?${qs}`;

  if (!publicBase) {
    return suffix;
  }

  return `${publicBase}${suffix}`;
}

function normalizePublicBase(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, '');
  }

  if (trimmed.startsWith('/')) {
    return trimmed.replace(/\/+$/, '');
  }

  // Treat other values (e.g., custom schemes) as provided but remove trailing slash.
  return trimmed.replace(/\/+$/, '');
}
