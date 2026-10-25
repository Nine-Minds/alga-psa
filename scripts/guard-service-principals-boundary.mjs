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
export const SELF_EXEMPT_PATHS = [
  'scripts/guard-service-principals-boundary.mjs',
  'server/src/test/unit/editionBoundary/servicePrincipalsBoundary.guard.test.ts',
];

const SCANNED_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|json|sql|ya?ml|sh)$/;
const SKIPPED_FILES = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml)$/;

// A key purpose is spelled on one line next to the word "purpose"; a lone
// 'service' string (e.g. the user type) is allowed.
export const FORBIDDEN_PATTERNS = [
  { name: 'service_principals table', regex: /\bservice_principals\b/ },
  { name: 'X-Alga-Act-As header', regex: /x-alga-act-as/i },
  {
    name: "'service' key purpose",
    regex: /purpose[^\n]*['"`]service['"`]|['"`]service['"`][^\n]*purpose/i,
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
      for (const { name, regex } of FORBIDDEN_PATTERNS) {
        if (regex.test(line)) {
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
