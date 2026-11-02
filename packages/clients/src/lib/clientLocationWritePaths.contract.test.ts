import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Coverage ledger for every `client_locations` write path. Each path either publishes
 * CLIENT_LOCATION_* (directly or through models/clientLocation.ts) or is listed as
 * intentionally silent with the reason. Adding a new writer without choosing one fails here.
 */
const root = path.resolve(__dirname, '../../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

describe('client_locations write-path publisher coverage', () => {
  it('the shared model publishes create, update (incl. deactivate) and delete', () => {
    const src = read('packages/clients/src/models/clientLocation.ts');
    expect(src).toContain('queueClientLocationCreated(');
    expect(src).toContain('queueClientLocationUpdated(');
    expect(src).toContain('queueClientLocationDeleted(');
  });

  it('UI actions, REST ClientService and the migration applier go through the model', () => {
    const actions = read('packages/clients/src/actions/clientLocationActions.ts');
    const service = read('server/src/lib/api/services/ClientService.ts');
    expect(actions).toMatch(/models\/clientLocation|createLocation|updateLocation|deleteLocation/);
    expect(service).toMatch(/createLocation|updateLocation|deleteLocation|ClientLocation/);
  });

  it.each([
    ['CSV client import', 'packages/clients/src/actions/clientActions.ts', 'queueClientLocationCreated'],
    ['Xero CSV client import', 'packages/integrations/src/services/xeroCsvClientSyncService.ts', 'CLIENT_LOCATION_CREATED'],
    ['Xero CSV client import (update)', 'packages/integrations/src/services/xeroCsvClientSyncService.ts', 'CLIENT_LOCATION_UPDATED'],
    ['onboarding saveClientInfo/createClient', 'packages/onboarding/src/actions/onboarding-actions/onboardingActions.ts', 'queueClientLocationCreated'],
    ['workflow upsertDefaultClientLocation + clients.duplicate', 'shared/workflow/runtime/actions/businessOperations/clients.ts', 'CLIENT_LOCATION_CREATED'],
    ['workflow upsertDefaultClientLocation (update)', 'shared/workflow/runtime/actions/businessOperations/clients.ts', 'CLIENT_LOCATION_UPDATED'],
  ])('%s publishes directly (bypasses the model)', (_name, file, marker) => {
    expect(read(file)).toContain(marker);
  });

  it('the model emits updates for implicit default demotion and promotion, not only the edited row', () => {
    const src = read('packages/clients/src/models/clientLocation.ts');
    const clear = src.slice(src.indexOf('async function clearDefaults('), src.indexOf('async function promoteLocation('));
    const promote = src.slice(src.indexOf('async function promoteLocation('), src.indexOf('export async function createLocation('));
    expect(clear).toContain('queueClientLocationUpdated(');
    expect(promote).toContain('queueClientLocationUpdated(');
  });

  it('client merge emits client_location.updated and contact.updated for re-parented children', () => {
    const src = read('packages/clients/src/lib/clientMergeEngine.ts');
    expect(src).toContain('queueClientLocationUpdated(');
    expect(src).toContain("queueContactUpdated(trx, tenant, before, after, ['client_id']");
  });
});

/**
 * Completeness: every source file that writes to `client_locations` must be classified here.
 * A new writer that is in neither list fails this test, forcing a published/silent decision.
 */
const PUBLISHED_WRITERS: Record<string, string> = {
  'packages/clients/src/models/clientLocation.ts': 'queueClientLocationUpdated',
  'packages/clients/src/actions/clientActions.ts': 'queueClientLocationCreated',
  'packages/clients/src/lib/clientMergeEngine.ts': 'queueClientLocationUpdated',
  'packages/integrations/src/services/xeroCsvClientSyncService.ts': 'CLIENT_LOCATION_UPDATED',
  'packages/onboarding/src/actions/onboarding-actions/onboardingActions.ts': 'queueClientLocationUpdated',
  'shared/workflow/runtime/actions/businessOperations/clients.ts': 'CLIENT_LOCATION_UPDATED',
};

const SILENT_WRITERS: Record<string, string> = {
  'ee/temporal-workflows/src/db/tenant-operations.ts':
    'tenant creation seeds the first location of a brand-new tenant; no webhook can exist yet',
  'packages/clients/src/actions/inboundActions.ts':
    'KNOWN GAP: upsertClientByExternalId writes the mapped contact/address fields to the default location (create and update) but publishes no client_location event, only the client-level CLIENT_CREATED/CLIENT_STATUS_CHANGED. Follow-up, out of scope for the client-creation seam extraction',
};

// Files that only delete locations because the client or tenant is being deleted (cascade).
const SILENT_DELETE_ONLY_NOTES = 'client hard delete removes the locations with the client; deletes cascade silently by design';

const WRITE_VERB = /\.(insert|update|del|delete|upsert)\(/;
const SKIP_DIR = /(^|\/)(node_modules|dist|migrations|generated|__tests__|test|tests|test-utils)$|^\.next|\.next/;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (SKIP_DIR.test(name)) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|d)\.tsx?$/.test(name)) out.push(full);
  }
}

function writersOfClientLocations(): string[] {
  const files: string[] = [];
  for (const base of ['packages', 'server/src', 'shared', 'ee/server/src', 'ee/temporal-workflows/src']) {
    const abs = path.join(root, base);
    try {
      if (statSync(abs).isDirectory()) walk(abs, files);
    } catch {
      /* optional tree */
    }
  }
  const writers: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    const writes = lines.some((line, i) => line.includes("'client_locations'") && WRITE_VERB.test(lines.slice(i, i + 9).join(' ')));
    if (writes) writers.push(path.relative(root, file));
  }
  return writers.sort();
}

describe('client_locations writer classification', () => {
  const writers = writersOfClientLocations();

  it('finds the known writers (guards the scanner itself)', () => {
    expect(writers).toContain('packages/clients/src/models/clientLocation.ts');
    expect(writers).toContain('packages/onboarding/src/actions/onboarding-actions/onboardingActions.ts');
  });

  it('every writer is classified as published or intentionally silent', () => {
    const unclassified = writers.filter((file) => !(file in PUBLISHED_WRITERS) && !(file in SILENT_WRITERS));
    expect(unclassified).toEqual([]);
  });

  it.each(Object.entries(PUBLISHED_WRITERS))('%s publishes (%s)', (file, marker) => {
    expect(read(file)).toContain(marker);
  });

  it.each(Object.entries(SILENT_WRITERS))('%s is silent: %s', (file, reason) => {
    expect(reason.length).toBeGreaterThan(10);
    expect(read(file)).not.toContain('CLIENT_LOCATION_');
  });

  it('documents why client-delete cascades are silent', () => {
    expect(SILENT_DELETE_ONLY_NOTES).toMatch(/cascade/);
  });
});
