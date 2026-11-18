/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No client selector loads the whole tenant client list (card F). A client picker searches and pages on
 * the server through `AsyncClientPicker` / `searchClientsForPicker`; a screen that fetches every client and
 * hands the rows to a picker keeps the slow in-memory path and the full fetch that feeds it.
 *
 * Mechanical form of that rule: no source file may both call a full-list client action and render a
 * `ClientPicker` / `AsyncClientPicker`, unless it is on the allowlist below. The allowlist holds only the
 * screens where a full list is correct: exports and bulk reads, which stay server-side.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../..');

/** Actions that return every client in the tenant (or every active one). */
const FULL_LIST_CALLS = [
  'getAllClients(',
  'getSchedulingClients(',
  'getDocumentAssociationClientsForPicker(',
  'getIntegrationClients(',
];

const PICKER_RENDER = /<\s*(?:Async)?ClientPicker[\s>]/;

/** Repo-relative paths where a full client list is deliberate (exports / bulk reads), with the reason. */
const ALLOWLIST: Record<string, string> = {
  'packages/clients/src/components/clients/Clients.tsx':
    'The Clients page CSV export loads every client; the list itself is paginated on the server.',
  'server/src/app/api/clients/route.ts':
    'Bulk client list endpoint (JSON); not a picker.',
};

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '__tests__', 'coverage']);

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || file.includes(`${path.sep}__tests__${path.sep}`);
}

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !isTestFile(path.join(dir, entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
}

function sourceRoots(): string[] {
  const roots: string[] = [];
  const packagesDir = path.join(REPO_ROOT, 'packages');
  for (const pkg of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (pkg.isDirectory()) roots.push(path.join(packagesDir, pkg.name, 'src'));
  }
  roots.push(path.join(REPO_ROOT, 'server/src'), path.join(REPO_ROOT, 'ee/server/src'));
  return roots;
}

/** Drops comments so a note about a removed fetch is not mistaken for a call. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function offenders(files: string[], read: (file: string) => string, allow: Record<string, string>): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
    if (rel in allow) continue;
    const source = stripComments(read(file));
    const call = FULL_LIST_CALLS.find((name) => source.includes(name));
    if (call && PICKER_RENDER.test(source)) hits.push(`${rel} (calls ${call}) and renders a client picker`);
  }
  return hits;
}

describe('client pickers never load the whole tenant client list', () => {
  const files: string[] = [];
  for (const root of sourceRoots()) walk(root, files);
  const read = (file: string) => fs.readFileSync(file, 'utf8');

  it('scans the source trees it is meant to guard', () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(files.some((file) => file.endsWith('ee/server/src/components/settings/integrations/EntraTenantMappingTable.tsx'))).toBe(true);
    expect(files.some((file) => file.endsWith('packages/documents/src/components/AssociatedEntityPicker.tsx'))).toBe(true);
  });

  it('has no file that both calls a full-list client action and renders a client picker', () => {
    expect(offenders(files, read, ALLOWLIST)).toEqual([]);
  });

  it('allowlists only files that exist and still need it', () => {
    for (const rel of Object.keys(ALLOWLIST)) {
      const file = path.join(REPO_ROOT, rel);
      expect(fs.existsSync(file), `${rel} is allowlisted but missing`).toBe(true);
      const source = stripComments(read(file));
      expect(
        FULL_LIST_CALLS.some((name) => source.includes(name)),
        `${rel} is allowlisted but no longer calls a full-list client action; remove it`,
      ).toBe(true);
    }
  });

  it('flags a file that fetches every client for a picker (the check can fail)', () => {
    const fake = path.join(REPO_ROOT, 'packages/example/src/Bad.tsx');
    const bad = `const clients = await getAllClients(true);\nreturn <ClientPicker clients={clients} />;`;
    const good = `// getAllClients( was removed\nreturn <ClientPicker selectedClientId={id} onSelect={set} />;`;
    expect(offenders([fake], () => bad, {})).toHaveLength(1);
    expect(offenders([fake], () => good, {})).toEqual([]);
    expect(offenders([fake], () => bad, { 'packages/example/src/Bad.tsx': 'test' })).toEqual([]);
  });
});
