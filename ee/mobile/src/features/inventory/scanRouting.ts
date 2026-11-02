import { matchRecordPath, type MatchedRecordPath } from "../../urls/recordLinks";

/**
 * Decides what a scanned (or pasted) code means before anything is fetched.
 *
 * A QR code is not a secret and not trusted input. This module only
 * classifies; the destination screen's REST read does the authorization.
 *
 * - `record`          absolute http(s) URL on the connected server's origin
 *                     that the shared resolver recognises as a record link.
 * - `foreign-record`  a record link on any OTHER origin. It must never be
 *                     fetched, sent to inventory lookup or opened as-is.
 * - `code`            anything else, including http(s) URLs that are not
 *                     record links. Today's lookup behaviour is unchanged.
 */
export type ScanClassification =
  | { kind: "record"; target: MatchedRecordPath }
  | { kind: "foreign-record"; host: string }
  | { kind: "code"; code: string };

type ParsedHttpUrl = { host: string; pathAndQuery: string; hasUserInfo: boolean };

const HTTP_URL_RE = /^https?:\/\/([^/?#]*)([^#]*)/i;

function normalizeHost(authority: string): string {
  let host = authority.slice(authority.lastIndexOf("@") + 1).toLowerCase();
  // Default ports are the same origin regardless of scheme.
  host = host.replace(/:(?:80|443)$/, "");
  return host.replace(/\.(?=:\d+$|$)/, "");
}

function parseHttpUrl(input: string): ParsedHttpUrl | null {
  const match = HTTP_URL_RE.exec(input);
  if (!match || match[1].length === 0) return null;
  return {
    host: normalizeHost(match[1]),
    pathAndQuery: match[2],
    hasUserInfo: match[1].includes("@"),
  };
}

export function classifyScannedCode(code: string, baseUrl: string | null | undefined): ScanClassification {
  const trimmed = typeof code === "string" ? code.trim() : "";
  const passthrough: ScanClassification = { kind: "code", code };
  if (!trimmed || /\s/.test(trimmed)) return passthrough;

  const parsed = parseHttpUrl(trimmed);
  if (!parsed) return passthrough;

  const target = matchRecordPath(parsed.pathAndQuery);
  if (!target) return passthrough;

  const base = baseUrl ? parseHttpUrl(baseUrl.trim()) : null;
  if (!base || parsed.hasUserInfo || parsed.host !== base.host) {
    return { kind: "foreign-record", host: parsed.host };
  }
  return { kind: "record", target };
}
