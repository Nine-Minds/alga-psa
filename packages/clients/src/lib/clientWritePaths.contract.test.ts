import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Coverage ledger for every production writer that sets `clients.is_inactive` (direct `clients` table
 * writes that touch the flag, plus ClientModel.createClient/updateClient callers). Each writer either
 * publishes CLIENT_CREATED / CLIENT_UPDATED / CLIENT_ARCHIVED / CLIENT_STATUS_CHANGED / CLIENT_MERGED
 * (the marker proves it) or is listed as intentionally silent with the reason. A new writer in neither
 * list fails the completeness test.
 */
const root = path.resolve(__dirname, '../../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

/** writer file -> [file that must contain the marker, marker] */
const PUBLISHED_WRITERS: Record<string, [string, string]> = {
  // UI: updateClient, createClient, CSV import, markClientInactive/ActiveWithContacts.
  'packages/clients/src/actions/clientActions.ts': ['packages/clients/src/actions/clientActions.ts', "eventType: 'CLIENT_UPDATED'"],
  'packages/clients/src/actions/inboundActions.ts': ['packages/clients/src/actions/inboundActions.ts', 'CLIENT_STATUS_CHANGED'],
  // Merge tombstones the source client; clientMergeActions publishes CLIENT_MERGED (public client.deleted).
  'packages/clients/src/lib/clientMergeEngine.ts': ['packages/clients/src/actions/clientMergeActions.ts', 'CLIENT_MERGED'],
  'server/src/lib/migrations/appliers/entityAppliers.ts': ['server/src/lib/migrations/appliers/entityAppliers.ts', 'CLIENT_CREATED'],
  'shared/workflow/runtime/actions/businessOperations/clients.ts': ['shared/workflow/runtime/actions/businessOperations/clients.ts', 'CLIENT_ARCHIVED'],
  // REST ClientService.update/create (scanner-invisible: writes through the generic service layer).
};

// Datto site provisioning and the Xero CSV sync used to insert `clients` rows
// directly (is_inactive literal in the same file), which is how the scanner
// used to find them. Both now create through the shared
// `createClientWithDefaults` seam (shared/models/clientCreation.ts), so the
// is_inactive default lives there instead and the scanner no longer sees
// these two call sites as writers. Their CLIENT_CREATED publish is unchanged
// and still covered by their own integration tests.

const SILENT_WRITERS: Record<string, string> = {
  'ee/temporal-workflows/src/activities/customer-tracking-activities.ts':
    'Temporal tenant-provisioning activity: creates/reactivates the Nine Minds management-tenant customer client for a new tenant; no user actor and the worker has no event-bus publisher',
  'ee/temporal-workflows/src/activities/tenant-deletion-activities.ts':
    'Temporal tenant deactivate/reactivate flips the management-tenant customer client as part of the tenant lifecycle; operator-driven, not a tenant user action, and the worker has no event-bus publisher',
  'server/src/lib/service-requests/mapping/destinations/accountDestinationProvider.ts':
    'KNOWN GAP: service-request answer mapping updates clients through ClientModel.updateClient (is_inactive is a mappable field) and publishes no client.updated for any field; user-reachable via admin-configured mappings. Follow-up, out of scope for the reactivation fix',
};
// ee/temporal-workflows/src/db/tenant-operations.ts and
// packages/tickets/src/actions/ticketImportActions.ts moved for the same
// reason as the two PUBLISHED_WRITERS above: both now create through
// createClientWithDefaults, so the scanner no longer finds them here either.

// REST ClientService is not found by the scanner (generic service layer); pin its markers directly.
const SERVICE_MARKERS = ['CLIENT_ARCHIVED', 'CLIENT_UPDATED', 'CLIENT_CREATED'];

const WRITE_VERB = /\.(insert|update|del|delete|upsert)\(/;
const MODEL_WRITE = /ClientModel\.(createClient|updateClient)\(/;
const SKIP = /^(node_modules|dist|generated|__tests__|test|tests|test-utils|seeds)$|^\.next/;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP.test(name)) continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // dangling symlink (e.g. generated build scratch): not a source file
    }
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|d)\.tsx?$/.test(name)) out.push(full);
  }
}

function writersOfClientIsInactive(): string[] {
  const files: string[] = [];
  for (const base of ['packages', 'server/src', 'shared', 'ee/server/src', 'ee/packages', 'ee/temporal-workflows/src']) {
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
    const writes = lines.some((line, i) => {
      if (MODEL_WRITE.test(line)) return true;
      if (!/['"]clients['"]/.test(line)) return false;
      const window = lines.slice(i, i + 9).join(' ');
      return WRITE_VERB.test(window) && /\bis_inactive\b/.test(window);
    });
    if (writes) writers.push(path.relative(root, file));
  }
  return writers.sort();
}

describe('clients.is_inactive writer classification', () => {
  const writers = writersOfClientIsInactive();
  const modelOwner = 'shared/models/clientModel.ts';

  it('finds the known writers (guards the scanner itself)', () => {
    expect(writers).toContain('packages/clients/src/actions/clientActions.ts');
    expect(writers).toContain('packages/clients/src/lib/clientMergeEngine.ts');
    expect(writers).toContain('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts');
  });

  it('every writer is classified as published or intentionally silent', () => {
    const unclassified = writers.filter(
      (file) => file !== modelOwner && !(file in PUBLISHED_WRITERS) && !(file in SILENT_WRITERS)
    );
    expect(unclassified).toEqual([]);
  });

  it('no classified writer is stale (still found by the scanner)', () => {
    const stale = [...Object.keys(PUBLISHED_WRITERS), ...Object.keys(SILENT_WRITERS)].filter(
      (file) => !writers.includes(file)
    );
    expect(stale).toEqual([]);
  });

  it.each(Object.entries(PUBLISHED_WRITERS))('%s publishes', (_file, [markerFile, marker]) => {
    expect(read(markerFile)).toContain(marker);
  });

  it.each(Object.entries(SILENT_WRITERS))('%s is silent: %s', (_file, reason) => {
    expect(reason.length).toBeGreaterThan(20);
  });

  it.each(SERVICE_MARKERS)('REST ClientService publishes %s', (marker) => {
    expect(read('server/src/lib/api/services/ClientService.ts')).toContain(marker);
  });

  it('markClientActiveWithContacts (UI reactivation) is PUBLISHED: queues CLIENT_UPDATED[is_inactive] after commit', () => {
    const src = read('packages/clients/src/actions/clientActions.ts');
    const fn = src.slice(src.indexOf('export const markClientActiveWithContacts'));
    const body = fn.slice(0, fn.indexOf('export const reactivateClientContacts'));
    expect(body).toContain("updatedFieldKeys: ['is_inactive']");
    expect(body).toContain('registerAfterCommit(trx');
    expect(body).toContain("eventType: 'CLIENT_UPDATED'");
  });

  it('markClientInactiveWithContacts publishes CLIENT_ARCHIVED', () => {
    const src = read('packages/clients/src/actions/clientActions.ts');
    const fn = src.slice(src.indexOf('export const markClientInactiveWithContacts'));
    expect(fn.slice(0, fn.indexOf('export const markClientActiveWithContacts'))).toContain("eventType: 'CLIENT_ARCHIVED'");
  });
});
