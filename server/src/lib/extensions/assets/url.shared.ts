/**
 * Shared builder for extension UI iframe src URLs.
 * Enforces content hash format and handles RUNNER_PUBLIC_BASE when EXT_UI_HOST_MODE === "rust".
 *
 * Example:
 *   const src = buildExtUiSrc("ext-123", "sha256:...64hex...", "/");
 *   <iframe src={src} sandbox="allow-scripts"></iframe>
 */
export function buildExtUiSrc(extensionId: string, contentHash: string, clientPath: string): string {
  // Enforce canonical content hash format: "sha256:<64-hex>"
  if (!/^sha256:[0-9a-f]{64}$/i.test(contentHash)) {
    throw new Error("Invalid content hash; expected format 'sha256:<hex64>'");
  }

  const mode = (process.env.EXT_UI_HOST_MODE || "rust").toLowerCase();
  const publicBase = process.env.RUNNER_PUBLIC_BASE || "";

  const base =
    mode === "rust" && publicBase && isAbsoluteUrl(publicBase) ? publicBase : "";

  const qs = new URLSearchParams({ path: clientPath || "/" }).toString();
  const suffix = `/ext-ui/${encodeURIComponent(extensionId)}/${encodeURIComponent(
    contentHash
  )}/index.html?${qs}`;

  return base ? `${base}${suffix}` : suffix;
}

function isAbsoluteUrl(maybe: string): boolean {
  try {
    const u = new URL(maybe);
    return !!u.protocol && !!u.host;
  } catch {
    return false;
  }
}