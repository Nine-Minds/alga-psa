/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/**
 * Manifest v2 parser and validator (no external deps)
 * Pure TypeScript utilities for structural validation and normalization.
 * Intended for use in finalize/publish flows.
 *
 * All functions are pure: no I/O, no env access.
 */

export interface ManifestEndpoint {
  method: string;
  path: string;
  handler: string;
}

export interface ManifestV2 {
  name: string;
  publisher?: string;
  version: string;
  runtime: string;            // e.g., "wasm-js@1" or "wasm32-wasi@X"
  capabilities?: string[];    // e.g., ["http.fetch", "storage.kv"]
  ui?: {
    type: "iframe";
    entry: string;
    hooks?: {
      appMenu?: { label: string };
      clientPortalMenu?: { label: string };
      [key: string]: unknown;
    };
  };
  api?: { endpoints: ManifestEndpoint[] };
  assets?: string[];
  precompiled?: { [target: string]: string }; // optional mapping target->path (future-proof)
}

export interface ValidationOptions {
  allowExtraFields?: boolean;
}

export interface ValidationIssue {
  path: string;     // JSONPath-like, e.g., "api.endpoints[0].path" or "$" for root
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface ParseResult {
  manifest?: ManifestV2;
  issues: ValidationIssue[];
}

const SEMVER_LIKE_RE = /^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?(\+[A-Za-z0-9.-]+)?$/;
const SEMVER_WILDCARD_RE = /^\d+\.\d+\.\*$/; // e.g., "1.2.*" for auto-increment
const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
]);

const KNOWN_TOP_LEVEL_FIELDS = new Set<string>([
  "name",
  "publisher",
  "version",
  "runtime",
  "capabilities",
  "ui",
  "api",
  "assets",
  "precompiled",
]);

/**
 * Check if a string matches a semver-like pattern:
 * - Format: X.Y.Z
 * - Optional pre-release: -[A-Za-z0-9.-]+
 * - Optional build metadata: +[A-Za-z0-9.-]+
 * - Also accepts X.Y.* for auto-increment (wildcard)
 */
export function isValidSemverLike(version: string): boolean {
  if (typeof version !== "string" || version.trim() === "") return false;
  const v = version.trim();
  return SEMVER_LIKE_RE.test(v) || SEMVER_WILDCARD_RE.test(v);
}

/**
 * Check if version uses wildcard suffix (e.g., "1.2.*")
 */
export function isWildcardVersion(version: string): boolean {
  if (typeof version !== "string" || version.trim() === "") return false;
  return SEMVER_WILDCARD_RE.test(version.trim());
}

/**
 * Extract the version prefix from a wildcard version (e.g., "1.2.*" -> "1.2")
 */
export function getWildcardPrefix(version: string): string | null {
  if (!isWildcardVersion(version)) return null;
  return version.trim().replace(/\.\*$/, '');
}

/**
 * Resolve a wildcard version to the next increment based on existing versions.
 * @param wildcardVersion - Version with wildcard suffix (e.g., "1.2.*")
 * @param existingVersions - Array of existing version strings for the extension
 * @returns The resolved version (e.g., "1.2.0" if no existing, "1.2.5" if "1.2.4" exists)
 */
export function resolveWildcardVersion(wildcardVersion: string, existingVersions: string[]): string {
  const prefix = getWildcardPrefix(wildcardVersion);
  if (!prefix) {
    throw new Error(`Invalid wildcard version: ${wildcardVersion}`);
  }

  // Filter versions that match the prefix (e.g., "1.2.0", "1.2.1", etc.)
  const prefixPattern = new RegExp(`^${prefix.replace('.', '\\.')}\\.(\\d+)$`);
  let maxPatch = -1;

  for (const v of existingVersions) {
    const match = v.match(prefixPattern);
    if (match) {
      const patch = parseInt(match[1], 10);
      if (patch > maxPatch) {
        maxPatch = patch;
      }
    }
  }

  // Next version is maxPatch + 1 (starts at 0 if no existing)
  return `${prefix}.${maxPatch + 1}`;
}

/**
 * Minimal runtime validation:
 * - Non-empty string
 * - Contains at least one '@' or '-' (e.g., "wasm-js@1" or "wasm32-wasi@X")
 */
export function isValidRuntime(runtime: string): boolean {
  if (typeof runtime !== "string") return false;
  const r = runtime.trim();
  if (r.length === 0) return false;
  return r.includes("@") || r.includes("-");
}

/**
 * Validate an HTTP method against a known set (case-insensitive).
 */
export function isValidEndpointMethod(method: string): boolean {
  if (typeof method !== "string") return false;
  return HTTP_METHODS.has(method.toUpperCase());
}

/**
 * Basic path normalization:
 * - Removes leading "./"
 * - Collapses multiple consecutive slashes '//' to single '/'
 * - Does NOT resolve or modify '..' segments
 * - Does NOT force a leading '/' (callers can decide per context)
 *
 * Examples:
 *  - "./a/b"    -> "a/b"
 *  - "a//b///c" -> "a/b/c"
 *  - "/a//b"    -> "/a/b"
 */
export function sanitizePath(p: string): string {
  if (typeof p !== "string") return p as unknown as string;
  let out = p;

  // remove leading "./" (repeat until none)
  while (out.startsWith("./")) {
    out = out.slice(2);
  }

  // collapse multiple slashes to single slash, but keep protocol-like strings untouched
  // Since these are file-like or URL-like paths within a manifest bundle context,
  // we simply reduce consecutive slashes.
  out = out.replace(/\/{2,}/g, "/");

  return out;
}

/**
 * Validate manifest shape and semantics with structural checks (no external deps).
 * - Required fields: name (non-empty), version (semver-like), runtime (non-empty)
 * - api: if present, require endpoints array; for each endpoint:
 *   - method: valid HTTP verb (case-insensitive)
 *   - path: string, starts with '/', has no spaces, contains no '..'
 *   - handler: non-empty string, contains no '..'
 * - ui: if provided, must be { type: "iframe", entry: non-empty string (no '..') }
 * - capabilities: if provided, array of non-empty strings
 * - assets: if provided, array of non-empty strings
 * - precompiled: if provided, object mapping non-empty keys to non-empty strings
 * - Unknown top-level fields are reported as issues unless opts.allowExtraFields === true
 *
 * Returns all issues; valid is true only if no issues.
 */
export function validateManifestShape(input: unknown, opts?: ValidationOptions): ValidationResult {
  const issues: ValidationIssue[] = [];
  const allowExtra = !!opts?.allowExtraFields;

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    issues.push({
      path: "$",
      message: "Manifest must be a JSON object.",
    });
    return { valid: false, issues };
  }

  const obj = input as Record<string, unknown>;

  // Unknown field detection
  if (!allowExtra) {
    for (const key of Object.keys(obj)) {
      if (!KNOWN_TOP_LEVEL_FIELDS.has(key)) {
        issues.push({
          path: key,
          message: `Unknown top-level field '${key}'.`,
        });
      }
    }
  }

  // name
  if (!hasNonEmptyString(obj, "name")) {
    issues.push({
      path: "name",
      message: "Field 'name' is required and must be a non-empty string.",
    });
  }

  // version
  if (!hasString(obj, "version")) {
    issues.push({
      path: "version",
      message: "Field 'version' is required and must be a string.",
    });
  } else if (!isValidSemverLike(String(obj.version))) {
    issues.push({
      path: "version",
      message: "Field 'version' must be a semver-like string (e.g., 1.2.3, 1.2.3-beta, 1.2.3+build).",
    });
  }

  // runtime
  if (!hasString(obj, "runtime")) {
    issues.push({
      path: "runtime",
      message: "Field 'runtime' is required and must be a string.",
    });
  } else if (!isValidRuntime(String(obj.runtime))) {
    issues.push({
      path: "runtime",
      message: "Field 'runtime' must be a non-empty string containing '@' or '-'.",
    });
  }

  // publisher (optional, if present must be string non-empty?)
  if ("publisher" in obj && typeof obj.publisher !== "undefined") {
    if (typeof obj.publisher !== "string" || obj.publisher.trim() === "") {
      issues.push({
        path: "publisher",
        message: "Field 'publisher', if provided, must be a non-empty string.",
      });
    }
  }

  // capabilities
  if ("capabilities" in obj && typeof obj.capabilities !== "undefined") {
    const cap = obj.capabilities;
    if (!Array.isArray(cap)) {
      issues.push({
        path: "capabilities",
        message: "Field 'capabilities' must be an array of non-empty strings if provided.",
      });
    } else {
      cap.forEach((c, i) => {
        if (typeof c !== "string" || c.trim() === "") {
          issues.push({
            path: `capabilities[${i}]`,
            message: "Each capability must be a non-empty string.",
          });
        }
      });
    }
  }

  // assets
  if ("assets" in obj && typeof obj.assets !== "undefined") {
    const assets = obj.assets;
    if (!Array.isArray(assets)) {
      issues.push({
        path: "assets",
        message: "Field 'assets' must be an array of non-empty strings if provided.",
      });
    } else {
      assets.forEach((a, i) => {
        if (typeof a !== "string" || a.trim() === "") {
          issues.push({
            path: `assets[${i}]`,
            message: "Each asset must be a non-empty string.",
          });
        }
      });
    }
  }

  // precompiled
  if ("precompiled" in obj && typeof obj.precompiled !== "undefined") {
    const pc = obj.precompiled;
    if (typeof pc !== "object" || pc === null || Array.isArray(pc)) {
      issues.push({
        path: "precompiled",
        message: "Field 'precompiled' must be an object mapping non-empty keys to non-empty strings.",
      });
    } else {
      for (const [k, v] of Object.entries(pc)) {
        if (typeof k !== "string" || k.trim() === "") {
          issues.push({
            path: "precompiled",
            message: "Field 'precompiled' has an empty key which is not allowed.",
          });
        }
        if (typeof v !== "string" || v.trim() === "") {
          issues.push({
            path: `precompiled.${k}`,
            message: "Each precompiled mapping value must be a non-empty string.",
          });
        }
      }
    }
  }

  // ui
  if ("ui" in obj && typeof obj.ui !== "undefined") {
    const ui = obj.ui as unknown;
    if (typeof ui !== "object" || ui === null || Array.isArray(ui)) {
      issues.push({
        path: "ui",
        message: "Field 'ui' must be an object if provided.",
      });
    } else {
      const u = ui as Record<string, unknown>;
      if (u.type !== "iframe") {
        issues.push({
          path: "ui.type",
          message: "Field 'ui.type' must be exactly 'iframe' when 'ui' is provided.",
        });
      }
      if (!("entry" in u) || typeof u.entry !== "string" || u.entry.trim() === "") {
        issues.push({
          path: "ui.entry",
          message: "Field 'ui.entry' is required and must be a non-empty string when 'ui' is provided.",
        });
      } else if (containsDotDot(String(u.entry))) {
        issues.push({
          path: "ui.entry",
          message: "Field 'ui.entry' must not contain '..'.",
        });
      }

      if ("hooks" in u && typeof u.hooks !== "undefined") {
        const hooks = u.hooks as unknown;
        if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) {
          issues.push({
            path: "ui.hooks",
            message: "Field 'ui.hooks' must be an object if provided.",
          });
        } else {
          const h = hooks as Record<string, unknown>;
          if ("appMenu" in h && typeof h.appMenu !== "undefined") {
            const m = h.appMenu as unknown;
            if (typeof m !== "object" || m === null || Array.isArray(m)) {
              issues.push({
                path: "ui.hooks.appMenu",
                message: "Field 'ui.hooks.appMenu' must be an object if provided.",
              });
            } else {
              const mo = m as Record<string, unknown>;
              if (!("label" in mo) || typeof mo.label !== "string" || mo.label.trim() === "") {
                issues.push({
                  path: "ui.hooks.appMenu.label",
                  message: "Field 'ui.hooks.appMenu.label' is required and must be a non-empty string.",
                });
              }
            }
          }
          if ("clientPortalMenu" in h && typeof h.clientPortalMenu !== "undefined") {
            const m = h.clientPortalMenu as unknown;
            if (typeof m !== "object" || m === null || Array.isArray(m)) {
              issues.push({
                path: "ui.hooks.clientPortalMenu",
                message: "Field 'ui.hooks.clientPortalMenu' must be an object if provided.",
              });
            } else {
              const mo = m as Record<string, unknown>;
              if (!("label" in mo) || typeof mo.label !== "string" || mo.label.trim() === "") {
                issues.push({
                  path: "ui.hooks.clientPortalMenu.label",
                  message: "Field 'ui.hooks.clientPortalMenu.label' is required and must be a non-empty string.",
                });
              }
            }
          }
        }
      }
    }
  }

  // api
  if ("api" in obj && typeof obj.api !== "undefined") {
    const api = obj.api as unknown;
    if (typeof api !== "object" || api === null || Array.isArray(api)) {
      issues.push({
        path: "api",
        message: "Field 'api' must be an object if provided.",
      });
    } else {
      const a = api as Record<string, unknown>;
      if (!("endpoints" in a)) {
        issues.push({
          path: "api.endpoints",
          message: "Field 'api.endpoints' is required when 'api' is provided.",
        });
      } else {
        const endpoints = a.endpoints as unknown;
        if (!Array.isArray(endpoints)) {
          issues.push({
            path: "api.endpoints",
            message: "Field 'api.endpoints' must be an array.",
          });
        } else {
          endpoints.forEach((ep, i) => {
            const base = `api.endpoints[${i}]`;
            if (typeof ep !== "object" || ep === null || Array.isArray(ep)) {
              issues.push({
                path: base,
                message: "Each endpoint must be an object.",
              });
              return;
            }
            const e = ep as Record<string, unknown>;

            // method
            if (!("method" in e) || typeof e.method !== "string" || e.method.trim() === "") {
              issues.push({
                path: `${base}.method`,
                message: "Endpoint 'method' is required and must be a non-empty string.",
              });
            } else if (!isValidEndpointMethod(String(e.method))) {
              issues.push({
                path: `${base}.method`,
                message: "Endpoint 'method' must be one of: GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD (case-insensitive).",
              });
            }

            // path
            if (!("path" in e) || typeof e.path !== "string" || e.path.trim() === "") {
              issues.push({
                path: `${base}.path`,
                message: "Endpoint 'path' is required and must be a non-empty string starting with '/'.",
              });
            } else {
              const rawPath = String(e.path);
              if (/\s/.test(rawPath)) {
                issues.push({
                  path: `${base}.path`,
                  message: "Endpoint 'path' must not contain spaces.",
                });
              }
              if (containsDotDot(rawPath)) {
                issues.push({
                  path: `${base}.path`,
                  message: "Endpoint 'path' must not contain '..'.",
                });
              }
              // Check starts with '/'
              const norm = ensureLeadingSlash(sanitizePath(rawPath));
              if (!norm.startsWith("/")) {
                issues.push({
                  path: `${base}.path`,
                  message: "Endpoint 'path' must start with '/'.",
                });
              }
            }

            // handler
            if (!("handler" in e) || typeof e.handler !== "string" || e.handler.trim() === "") {
              issues.push({
                path: `${base}.handler`,
                message: "Endpoint 'handler' is required and must be a non-empty string.",
              });
            } else if (containsDotDot(String(e.handler))) {
              issues.push({
                path: `${base}.handler`,
                message: "Endpoint 'handler' must not contain '..'.",
              });
            }
          });
        }
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Parse JSON text into a ManifestV2 with validation.
 * - On JSON.parse error, returns issues with path "$".
 * - On successful parse, validates via validateManifestShape.
 * - If valid, returns the manifest (unmodified); otherwise returns no manifest.
 */
export function parseManifestJson(jsonText: string, opts?: ValidationOptions): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid JSON";
    return {
      issues: [{ path: "$", message }],
    };
  }

  const result = validateManifestShape(parsed, opts);
  if (result.valid) {
    // We can safely cast here because shape validation passed
    return {
      manifest: parsed as ManifestV2,
      issues: [],
    };
  }
  return { issues: result.issues };
}

/**
 * Extract normalized endpoints:
 * - method upper-cased
 * - path sanitized (collapse '//', remove leading './') and ensured to start with '/'
 * - handler sanitized (collapse '//', remove leading './')
 * Assumes manifest is valid; does not re-validate or reject.
 */
export function extractEndpoints(manifest: ManifestV2): ManifestEndpoint[] {
  const eps = manifest.api?.endpoints ?? [];
  return eps.map((e) => {
    const method = (e.method ?? "").toUpperCase();
    const path = ensureLeadingSlash(sanitizePath(e.path ?? ""));
    const handler = sanitizePath(e.handler ?? "");
    return { method, path, handler };
  });
}

/**
 * Get sanitized UI entry if present and valid:
 * - Returns sanitized entry (remove leading './', collapse '//') when ui.type === "iframe"
 * - Returns undefined otherwise
 */
export function getUiEntry(manifest: ManifestV2): string | undefined {
  const ui = manifest.ui;
  if (!ui || ui.type !== "iframe") return undefined;
  if (typeof ui.entry !== "string" || ui.entry.trim() === "") return undefined;
  if (containsDotDot(ui.entry)) return undefined;
  return sanitizePath(ui.entry);
}

/**
 * Return normalized UI hooks if present:
 * - Trims labels
 * - Drops empty/invalid labels
 * - Returns undefined when no valid hooks remain
 */
export function getUiHooks(manifest: ManifestV2): NonNullable<ManifestV2["ui"]>["hooks"] | undefined {
  const ui = manifest.ui;
  if (!ui || ui.type !== "iframe") return undefined;
  const hooks = ui.hooks as unknown;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return undefined;

  const h = hooks as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  const appMenu = h.appMenu as unknown;
  if (appMenu && typeof appMenu === "object" && !Array.isArray(appMenu)) {
    const label = typeof (appMenu as any).label === "string" ? String((appMenu as any).label).trim() : "";
    if (label) out.appMenu = { label };
  }

  const clientPortalMenu = h.clientPortalMenu as unknown;
  if (clientPortalMenu && typeof clientPortalMenu === "object" && !Array.isArray(clientPortalMenu)) {
    const label = typeof (clientPortalMenu as any).label === "string" ? String((clientPortalMenu as any).label).trim() : "";
    if (label) out.clientPortalMenu = { label };
  }

  return Object.keys(out).length > 0 ? (out as any) : undefined;
}

/**
 * Return capabilities or empty array if absent.
 */
export function getCapabilities(manifest: ManifestV2): string[] {
  return Array.isArray(manifest.capabilities) ? manifest.capabilities.slice() : [];
}

/**
 * Return runtime as-is (string).
 */
export function getRuntime(manifest: ManifestV2): string {
  return manifest.runtime;
}

/* =========================
   Internal helper functions
   ========================= */

function hasString(obj: Record<string, unknown>, key: string): boolean {
  return typeof obj[key] === "string";
}

function hasNonEmptyString(obj: Record<string, unknown>, key: string): boolean {
  return typeof obj[key] === "string" && (obj[key] as string).trim() !== "";
}

function containsDotDot(p: string): boolean {
  return p.includes("..");
}

function ensureLeadingSlash(p: string): string {
  if (typeof p !== "string" || p.length === 0) return p;
  return p.startsWith("/") ? p : "/" + p;
}
