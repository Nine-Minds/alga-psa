import { normalizeHostInput } from "./hostStore";

// Accepts alga://server?url=… (connect-this-server QR / deep link) or a raw
// host/URL payload. Returns the normalized https host, never persists it.
export function parseServerHostPayload(data: string): string | null {
  const trimmed = data.trim();
  if (!trimmed) return null;
  if (/^alga:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const isServerPath = url.host === "server" || url.pathname.replace(/\/+$/, "").endsWith("/server");
      if (!isServerPath) return null;
      const target = url.searchParams.get("url");
      return target ? (normalizeHostInput(target) ?? null) : null;
    } catch {
      return null;
    }
  }
  return normalizeHostInput(trimmed) ?? null;
}
