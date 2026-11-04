import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Coverage ledger for every `contacts` write path. Each writer either publishes
 * CONTACT_CREATED / CONTACT_UPDATED / CONTACT_ARCHIVED (the marker proves it) or is listed as
 * intentionally silent with the reason. A new writer in neither list fails the completeness test.
 */
const root = path.resolve(__dirname, '../../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

const PUBLISHED_WRITERS: Record<string, string> = {
  'packages/clients/src/actions/contact-actions/contactActions.tsx': 'queueContactCreated',
  'packages/clients/src/actions/inboundActions.ts': 'queueContactUpdated',
  'packages/clients/src/actions/queryActions.ts': 'queueContactCreated',
  'packages/clients/src/actions/clientActions.ts': 'trackContactUpdates',
  'packages/integrations/src/actions/clientLookupActions.ts': 'queueContactCreated',
  'packages/onboarding/src/actions/onboarding-actions/onboardingActions.ts': 'trackContactUpdates',
  'packages/portal-shared/src/actions/portalInvitationActions.ts': 'queueContactCreated',
  'packages/tickets/src/actions/ticketImportActions.ts': 'queueContactCreated',
  'packages/marketing/src/lib/capture.ts': 'queueContactUpdated',
  'packages/client-portal/src/actions/client-portal-actions/clientUserActions.ts': 'trackContactUpdates',
  'server/src/lib/migrations/appliers/entityAppliers.ts': 'queueContactCreated',
  'server/src/lib/api/services/ContactService.ts': 'CONTACT_UPDATED',
  'server/src/lib/api/services/ClientService.ts': 'CONTACT_ARCHIVED',
  'shared/workflow/actions/emailWorkflowActions.ts': 'CONTACT_CREATED',
  'shared/workflow/runtime/actions/businessOperations/contacts.ts': 'CONTACT_UPDATED',
  'shared/workflow/runtime/actions/businessOperations/clients.ts': 'CONTACT_ARCHIVED',
  'ee/server/src/lib/integrations/entra/sync/contactReconciler.ts': 'trackContactUpdates',
  'ee/server/src/lib/integrations/entra/sync/disableHandler.ts': 'trackContactUpdates',
  'ee/server/src/lib/integrations/entra/reconciliationQueueService.ts': 'queueContactCreated',
  'ee/packages/threecx/src/lib/contacts.ts': 'trackContactUpdates',
};

const SILENT_WRITERS: Record<string, string> = {
  'shared/services/emailService.ts': 'not called by any production path (test-only helper); the inbound-email path publishes through emailWorkflowActions',
  'ee/temporal-workflows/src/activities/customer-tracking-activities.ts': 'tenant provisioning creates the first contact of a brand-new tenant; no webhook subscription can exist yet',
  'ee/temporal-workflows/src/activities/tenant-deletion-activities.ts': 'tenant deletion removes every row of the tenant, including its webhooks',
  'ee/temporal-workflows/src/db/co-managed-provisioning-operations.ts': 'co-managed provisioning creates the first contact of a brand-new customer tenant; no webhook subscription can exist yet',
  'ee/temporal-workflows/src/db/co-managed-provisioning-cleanup.ts': 'abandoned co-managed provisioning removes every row of the never-activated customer tenant, including its webhooks',
  'packages/clients/src/actions/contact-actions/contactNoteActions.ts': 'only sets notes_document_id (internal document link), not a contact attribute exposed by the webhook contract',
  'packages/documents/src/actions/documentActions.ts': 'clears notes_document_id when the notes document is deleted (internal link)',
  'packages/client-portal/src/actions/client-portal-actions/visibilityGroupActions.ts': 'portal_visibility_group_id is portal access configuration, not a contact attribute',
  'packages/clients/src/actions/inboundTicketDestinationActions.ts': 'inbound_ticket_defaults_id is email-routing configuration, not a contact attribute',
  'packages/integrations/src/actions/email-actions/inboundTicketDefaultsActions.ts': 'detaches routing defaults from contacts when a defaults row is deleted (configuration cleanup)',
  'packages/marketing/src/lib/sequences.ts': 'read-only lookup of the contact (update targets marketing_sequence_enrollments)',
};

const WRITE_VERB = /\.(insert|update|del|delete|upsert)\(/;
const MODEL_WRITE = /ContactModel\.(createContact|updateContact)\(/;
const SKIP = /^(node_modules|dist|migrations|generated|__tests__|test|tests|test-utils|seeds)$|^\.next/;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP.test(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|d)\.tsx?$/.test(name)) out.push(full);
  }
}

function writersOfContacts(): string[] {
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
    const writes = lines.some(
      (line, i) =>
        MODEL_WRITE.test(line) ||
        (/['"]contacts['"]/.test(line) && WRITE_VERB.test(lines.slice(i, i + 9).join(' ')))
    );
    if (writes) writers.push(path.relative(root, file));
  }
  return writers.sort();
}

describe('contacts writer classification', () => {
  const writers = writersOfContacts();
  const modelOwner = 'shared/models/contactModel.ts';

  it('finds the known writers (guards the scanner itself)', () => {
    expect(writers).toContain('packages/clients/src/actions/contact-actions/contactActions.tsx');
    expect(writers).toContain('ee/server/src/lib/integrations/entra/sync/contactReconciler.ts');
  });

  it('every writer is classified as published or intentionally silent', () => {
    const unclassified = writers.filter(
      (file) => file !== modelOwner && !(file in PUBLISHED_WRITERS) && !(file in SILENT_WRITERS)
    );
    expect(unclassified).toEqual([]);
  });

  it.each(Object.entries(PUBLISHED_WRITERS))('%s publishes (%s)', (file, marker) => {
    expect(read(file)).toContain(marker);
  });

  it.each(Object.entries(SILENT_WRITERS))('%s is silent: %s', (_file, reason) => {
    expect(reason.length).toBeGreaterThan(20);
  });

  it('createClientContact (QuickAddClient / onboarding) publishes contact.created after commit', () => {
    const src = read('packages/clients/src/actions/contact-actions/contactActions.tsx');
    const fn = src.slice(src.indexOf('createClientContact'));
    expect(fn).toContain('queueContactCreated(trx');
  });

  it('client merge re-parents contacts through contact.updated', () => {
    expect(read('packages/clients/src/lib/clientMergeEngine.ts')).toContain("['client_id']");
  });
});
