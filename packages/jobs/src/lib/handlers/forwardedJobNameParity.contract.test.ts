import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every job the Temporal worker forwards must have a server-side handler.
 *
 * In EE the worker cannot execute these handlers itself — they import vertical
 * packages (@alga-psa/integrations, provider clients under ee/server) that the
 * plain-Node-ESM worker cannot load. So it forwards a MAINTENANCE_JOB_REQUESTED
 * event and a server subscriber runs the handler from registerAllHandlers.
 *
 * That makes the job name a contract spanning two files that share no imports:
 * the worker inlines the names as string literals on purpose, because importing
 * the constants would pull the unloadable handler module back into its static
 * graph. Nothing else checks that the two sides agree.
 *
 * The failure this catches is nasty: the schedule is created, it fires, and the
 * worker has no handler for it. EE only, only once a schedule actually
 * triggers, and invisible to typecheck — which is exactly how rmm-device-sync
 * was first written.
 */

const repoRoot = path.resolve(__dirname, '../../../../..');
const WORKER_FILE = 'ee/temporal-workflows/src/activities/job-activities.ts';
const SERVER_FILE = 'server/src/lib/jobs/registerAllHandlers.ts';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

/** Job names the worker forwards, resolved from its inlined const literals. */
function forwardedJobNames(source: string): string[] {
  const literals = new Map<string, string>();
  for (const match of source.matchAll(/const\s+([A-Z0-9_]+)\s*=\s*'([^']+)'/g)) {
    literals.set(match[1], match[2]);
  }

  const forwarded: string[] = [];
  for (const match of source.matchAll(
    /registerJobHandlerForActivities\(\s*([A-Za-z0-9_]+)\s*,\s*forwardJobToServer\(/g,
  )) {
    const value = literals.get(match[1]);
    if (value) forwarded.push(value);
  }
  return [...new Set(forwarded)];
}

/**
 * Job names registered server-side. registerAllHandlers uses imported
 * constants, so resolve each identifier back to its literal by scanning the
 * handler modules that export it.
 */
function serverRegisteredJobNames(source: string): string[] {
  // Registrations use either an imported constant or an inline literal; both
  // are in use today, so collect both rather than assuming one style.
  const identifiers = [...source.matchAll(/name:\s*([A-Z0-9_]+)\s*,/g)].map((m) => m[1]);
  const literalNames = [...source.matchAll(/name:\s*'([^']+)'\s*,/g)].map((m) => m[1]);
  if (identifiers.length === 0 && literalNames.length === 0) return [];

  const constantValues = new Map<string, string>();
  const roots = ['packages/jobs/src', 'server/src'];
  const stack = roots.map((r) => path.join(repoRoot, r));

  while (stack.length) {
    const dir = stack.pop()!;
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', '.next'].includes(entry.name)) stack.push(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        for (const m of text.matchAll(/export\s+const\s+([A-Z0-9_]+)\s*=\s*'([^']+)'/g)) {
          constantValues.set(m[1], m[2]);
        }
      }
    }
  }

  const resolved = identifiers.map((id) => constantValues.get(id)).filter((v): v is string => !!v);
  return [...new Set([...resolved, ...literalNames])];
}

describe('forwarded job name parity', () => {
  const worker = read(WORKER_FILE);
  const server = read(SERVER_FILE);
  const forwarded = forwardedJobNames(worker);
  const registered = serverRegisteredJobNames(server);

  it('finds the jobs the worker forwards', () => {
    // Guards the parser itself: a regex that silently matched nothing would
    // make every assertion below vacuously true.
    expect(forwarded.length).toBeGreaterThan(2);
    expect(forwarded).toContain('rmm-alert-reconciliation');
  });

  it('finds the jobs the server registers', () => {
    expect(registered.length).toBeGreaterThan(5);
  });

  it('every forwarded job has a server-side handler registration', () => {
    const missing = forwarded.filter((name) => !registered.includes(name));
    expect(
      missing,
      missing.length === 0
        ? ''
        : `${missing.join(', ')} — forwarded by ${WORKER_FILE} but not registered in ${SERVER_FILE}. ` +
          'On EE the Temporal Schedule will fire and find no handler.',
    ).toEqual([]);
  });

  it('includes rmm-device-sync on both sides', () => {
    // The case that motivated this guard.
    expect(forwarded).toContain('rmm-device-sync');
    expect(registered).toContain('rmm-device-sync');
  });
});
