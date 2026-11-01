#!/usr/bin/env node

/**
 * Static edition-boundary guard for service principals (plan
 * ee/docs/plans/2026-10-18-service-principals, F096).
 *
 * Service-principal functionality is Enterprise only. This fails if any file
 * outside `ee/`, `packages/product-service-principals/` or `packages/ee/`
 * references:
 *   - the `service_principals` table
 *   - the `X-Alga-Act-As` header
 *   - the `'service'` API-key purpose
 *   - the service-principal entitlement (`SERVICE_PRINCIPAL_ENTITLEMENT`, its
 *     limit column `service_principal_limit` and `SERVICE_PRINCIPAL_LIMIT_*` codes)
 *
 * Deliberately NOT forbidden (edition-neutral names the plan allows in CE):
 * `TIER_FEATURES.SERVICE_PRINCIPALS` (the tier key, like CREDENTIALS), the
 * `service` user type, `principal`, `viaPrincipalUserId`, `withViaPrincipal`.
 *
 * Usage: node scripts/guard-service-principals-boundary.mjs
 */

import { readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ALLOWED_PREFIXES = ['ee/', 'packages/product-service-principals/', 'packages/ee/'];

// This guard and its test necessarily spell out the forbidden names.
// The generated Enterprise OpenAPI documents describe the EE-only act-as header and error
// codes by design; they are produced from the EE decorator under
// packages/product-service-principals/ee (sdk/scripts/generate-openapi.ts --edition ee).
// The Community documents (alga-openapi.{ce,}.*) stay subject to the guard.
export const SELF_EXEMPT_PATHS = [
  'scripts/guard-service-principals-boundary.mjs',
  'server/src/test/unit/editionBoundary/servicePrincipalsBoundary.guard.test.ts',
  'sdk/docs/openapi/alga-openapi.ee.json',
  'sdk/docs/openapi/alga-openapi.ee.yaml',
];

const SCANNED_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|json|sql|ya?ml|sh)$/;
const SKIPPED_FILES = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml)$/;

// The 'service' key purpose is a quoted 'service' literal with the word
// "purpose" on the same line or within PURPOSE_WINDOW lines of it (so a purpose
// tuple or union split across lines is still caught). A lone 'service' string
// (e.g. the user type) is allowed. Limitation: a literal more than
// PURPOSE_WINDOW lines from the word "purpose" is not detected.
export const PURPOSE_WINDOW = 3;
const SERVICE_LITERAL = /['"`]service['"`]/;
const PURPOSE_WORD = /purpose/i;
// `user_type: 'service'` / `userType === 'service'` is the (edition-neutral)
// user type, never a key purpose.
const USER_TYPE_VALUE = /user_?type['"`]?\s*(?:===?|!==?|:|=)\s*['"`]service['"`]/i;

export const FORBIDDEN_PATTERNS = [
  { name: 'service_principals table', regex: /\bservice_principals\b/ },
  { name: 'X-Alga-Act-As header', regex: /x-alga-act-as/i },
  {
    name: "'service' key purpose",
    regex: SERVICE_LITERAL,
    excludeRegex: USER_TYPE_VALUE,
    nearRegex: PURPOSE_WORD,
    nearWindow: PURPOSE_WINDOW,
  },
  {
    name: 'service-principal entitlement',
    regex: /\bSERVICE_PRINCIPAL_(?:ENTITLEMENT|LIMIT)\w*|\bservice_principal_limit\b/,
  },
];

export function isAllowedPath(path) {
  const normalized = path.split(sep).join('/');
  return ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/** @param {{ path: string, content: string }[]} files */
export function findViolations(files) {
  const violations = [];
  for (const { path, content } of files) {
    const normalized = path.split(sep).join('/');
    if (isAllowedPath(normalized) || SELF_EXEMPT_PATHS.includes(normalized)) continue;
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      for (const { name, regex, excludeRegex, nearRegex, nearWindow = 0 } of FORBIDDEN_PATTERNS) {
        if (!regex.test(line) || excludeRegex?.test(line)) continue;
        const from = Math.max(0, index - nearWindow);
        const to = Math.min(lines.length - 1, index + nearWindow);
        const near = !nearRegex || lines.slice(from, to + 1).some((candidate) => nearRegex.test(candidate));
        if (near) {
          violations.push({ path: normalized, line: index + 1, pattern: name, text: line.trim().slice(0, 160) });
        }
      }
    });
  }
  return violations;
}

/** Tracked and untracked-but-not-ignored text files under the repo root. */
export function collectRepoFiles(root) {
  const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr}`);
  }
  const files = [];
  for (const path of result.stdout.split('\0')) {
    if (!path || !SCANNED_EXTENSIONS.test(path) || SKIPPED_FILES.test(path) || isAllowedPath(path)) continue;
    try {
      files.push({ path, content: readFileSync(join(root, path), 'utf8') });
    } catch {
      // Deleted in the working tree but still indexed.
    }
  }
  return files;
}

export function formatViolations(violations) {
  return violations.map((v) => `${v.path}:${v.line} [${v.pattern}] ${v.text}`).join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const violations = findViolations(collectRepoFiles(root));
  if (violations.length > 0) {
    console.error('Service-principal edition boundary violated (allowed only in ee/, packages/product-service-principals/, packages/ee/):');
    console.error(formatViolations(violations));
    process.exit(1);
  }
  console.log(`Service-principal edition boundary OK (${relative(root, root) || '.'}).`);
}
