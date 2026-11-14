// @vitest-environment jsdom
import React from 'react';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createInstance, type i18n } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ARCHIVE_ALLOWED_AUDIENCES, ARCHIVE_EVIDENCE_CLASSES, classifyArchiveCandidate, coManagedArchiveManifestHash } from '@alga-psa/co-managed';

const actions = vi.hoisted(() => ({ list: vi.fn(), history: vi.fn() }));
vi.mock('@/lib/actions/coManagedArchiveActions', () => ({ listCoManagedArchiveSummaries: actions.list, getCoManagedArchive: actions.history }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const formatters = { formatDate: (d: Date) => d.toISOString().slice(0, 10) };
  return { useTranslation: (ns: string) => ({ t: translations.getFixedT(null, ns) }), useFormatters: () => formatters };
});

import CoManagedArchive from '@/components/co-managed/CoManagedArchive';

const OP = '33333333-3333-4333-8333-333333333333';
const summary = { operationId: OP, clientName: 'Acme Corp', sealedAt: '2026-10-31T00:00:00.000Z', cutoffAt: '2026-10-30T00:00:00.000Z', evidenceCount: 2, fileCount: 1, excludedCount: 2 };
const archiveIdentity = { tenant: '11111111-1111-4111-8111-111111111111', customer_tenant: '22222222-2222-4222-8222-222222222222',
  relationship_id: '33333333-3333-4333-8333-333333333333', operation_id: '44444444-4444-4444-8444-444444444444', cutoff_at: '2026-10-30T00:00:00.000Z' };
const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv', 'xx', 'yy'];
const packs = Object.fromEntries(LOCALES.map(locale => [locale, JSON.parse(fs.readFileSync(
  path.resolve(__dirname, `../../../../public/locales/${locale}/msp/co-managed-lifecycle.json`), 'utf8',
))]));
let translations: i18n;
const missingKeys: string[] = [];
beforeEach(async () => {
  actions.list.mockReset(); actions.history.mockReset();
  missingKeys.length = 0;
  translations = createInstance();
  await translations.init({
    lng: 'en', fallbackLng: false, defaultNS: 'msp/co-managed-lifecycle',
    resources: Object.fromEntries(LOCALES.map(locale => [locale, {
      'msp/co-managed-lifecycle': packs[locale],
      common: JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../../../public/locales/${locale}/common.json`), 'utf8')),
    }])),
    // Default English copy can conceal missing resources even in the English UI.
    saveMissing: true, missingKeyHandler: (_languages, _namespace, key) => { missingKeys.push(key); },
    interpolation: { escapeValue: false },
  });
});
afterEach(cleanup);

describe('CoManagedArchive (A2)', () => {
  it('lists archives by client name, with no ids in the table', async () => {
    actions.list.mockResolvedValue({ ok: true, items: [summary], nextPage: null });
    const { container } = render(<CoManagedArchive />);
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
    expect(container.textContent).not.toContain(OP);
  });

  it('opens an archive: shows retained entries, exclusions by reason and a file link, and nothing private', async () => {
    actions.list.mockResolvedValue({ ok: true, items: [summary], nextPage: null });
    actions.history.mockResolvedValue({ ok: true, history: { archive: summary, nextPage: null,
      entries: [{ id: 'e1', kind: 'conversation', event: 'recorded', occurredAt: '2026-10-01T00:00:00.000Z', audience: 'shared_it', note: null, markdown: 'shared with IT', deleted: false,
        author: { tenant: 't', kind: 'user', id: null, name: 'Tech', organization: 'MSP' } }],
      files: [{ archiveFileId: '44444444-4444-4444-8444-444444444444', fileName: 'report.pdf', size: 5 }],
      exclusions: [{ evidenceClass: 'conversation', reason: 'audience_not_allowlisted', count: 1 }, { evidenceClass: 'conversation', reason: 'after_cutoff', count: 1 }],
      retentionFailures: [{ evidenceId: 'e1', attachmentId: '55555555-5555-4555-8555-555555555555', status: 'retention_failed', reason: 'source_download_failed' }] } });
    const { container } = render(<CoManagedArchive />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect(await screen.findByText('shared with IT')).toBeInTheDocument();
    expect(screen.getByText('report.pdf').getAttribute('href')).toBe('/api/co-management/archive-files/44444444-4444-4444-8444-444444444444');
    expect(screen.getByText(/Private to the customer/)).toBeInTheDocument();
    expect(screen.getByText(/After the relationship ended/)).toBeInTheDocument();
    expect(screen.getByText(/Attachment not retained: Source attachment could not be downloaded/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/CUSTOMER-PRIVATE|POST-CUTOFF/);
    await waitFor(() => expect(actions.history).toHaveBeenCalledWith({ operationId: OP, page: 0 }));
  });

  it('a refused reader sees a denial, not an empty archive', async () => {
    actions.list.mockResolvedValue({ ok: false, reason: 'denied' });
    render(<CoManagedArchive />);
    expect(await screen.findByText(/do not have permission to view this archive/)).toBeInTheDocument();
  });

  it.each(LOCALES)('renders attachment retention failures from the %s locale without missing-key fallbacks', async locale => {
    await translations.changeLanguage(locale);
    actions.list.mockResolvedValue({ ok: true, items: [summary], nextPage: null });
    actions.history.mockResolvedValue({ ok: true, history: {
      archive: summary, nextPage: null, entries: [], files: [], exclusions: [],
      retentionFailures: [
        { evidenceId: 'e1', attachmentId: 'a1', status: 'retention_failed', reason: 'source_download_failed' },
        { evidenceId: 'e2', attachmentId: 'a2', status: 'retention_failed', reason: 'source_integrity_failed' },
      ],
    } });
    render(<CoManagedArchive />);
    fireEvent.click(await screen.findByRole('button', { name: packs[locale].archive.open }));
    await screen.findByRole('button', { name: packs[locale].archive.back });
    expect(missingKeys).toEqual([]);
    const archive = packs[locale].archive;
    expect(screen.getByRole('heading', { name: archive.retentionFailuresHeading })).toBeInTheDocument();
    for (const reason of [archive.reason.downloadFailed, archive.reason.integrityFailed]) {
      expect(screen.getByText(archive.retentionFailed.replace('{{reason}}', reason))).toBeInTheDocument();
    }
  });
});

describe('archive allowlist classification, per row class', () => {
  const at = (iso: string) => ({ evidence_id: 'x', payload_hash: 'h', occurred_at: iso });
  const cutoff = new Date('2026-10-30T00:00:00.000Z');
  const before = '2026-10-01T00:00:00.000Z', after = '2026-11-01T00:00:00.000Z';

  it('keeps shared and requester messages, MSP-private messages and audits', () => {
    for (const audience of ARCHIVE_ALLOWED_AUDIENCES) {
      const type = audience === 'organization_private' ? 'private_conversation' : 'conversation';
      expect(classifyArchiveCandidate({ ...at(before), source_type: type, payload: { audience } }, cutoff)).toEqual({ include: true });
    }
    expect(classifyArchiveCandidate({ ...at(before), source_type: 'work_audit', payload: {} }, cutoff)).toEqual({ include: true });
  });

  it('the allowlist holds only classes the evidence store accepts, including MSP-owned time evidence', () => {
    expect([...ARCHIVE_EVIDENCE_CLASSES].sort()).toEqual(['conversation', 'private_conversation', 'ticket_handoff', 'time_entry', 'work_audit', 'work_snapshot']);
    expect(classifyArchiveCandidate({ ...at(before), source_type: 'time_entry', payload: { audience: 'organization_private' } }, cutoff)).toEqual({ include: true });
    expect(classifyArchiveCandidate({ ...at(before), source_type: 'time_entry', payload: { audience: 'shared_it' } }, cutoff)).toEqual({ include: false, reason: 'audience_not_allowlisted' });
  });

  it('a customer-private row under either MSP-private label is never archivable (absent cases)', () => {
    // organization_private on the shared `conversation` thread is the CUSTOMER's private note.
    expect(classifyArchiveCandidate({ ...at(before), source_type: 'conversation', payload: { audience: 'organization_private' } }, cutoff)).toEqual({ include: false, reason: 'audience_not_allowlisted' });
    // private_conversation is the MSP's own private store; any other label on it is anomalous.
    for (const audience of ['internal', 'requester', 'shared_it', undefined]) {
      expect(classifyArchiveCandidate({ ...at(before), source_type: 'private_conversation', payload: { audience } }, cutoff)).toEqual({ include: false, reason: 'audience_not_allowlisted' });
    }
  });

  it('excludes customer-private messages, post-cutoff messages and any class not on the allowlist', () => {
    expect(classifyArchiveCandidate({ ...at(before), source_type: 'conversation', payload: { audience: 'internal' } }, cutoff)).toEqual({ include: false, reason: 'audience_not_allowlisted' });
    expect(classifyArchiveCandidate({ ...at(after), source_type: 'conversation', payload: { audience: 'shared_it' } }, cutoff)).toEqual({ include: false, reason: 'after_cutoff' });
    expect(classifyArchiveCandidate({ ...at(before), source_type: 'customer_file', payload: {} }, cutoff)).toEqual({ include: false, reason: 'class_not_allowlisted' });
  });
});

describe('archive manifest seals', () => {
  it('keeps legacy seals and hashes persisted retention failures independently of object key order', () => {
    const legacy = { version: 1 as const, evidence: [['e', 'h']] as [string, string][], files: [['f', 'c', 3]] as [string, string, number][],
      exclusions: [['conversation', 'after_cutoff', 1]] as [string, 'after_cutoff', number][] };
    const legacyRepresentation = [legacy.version, archiveIdentity.tenant, archiveIdentity.customer_tenant, archiveIdentity.relationship_id,
      archiveIdentity.operation_id, new Date(archiveIdentity.cutoff_at).toISOString(), legacy.evidence, legacy.files, legacy.exclusions];
    const legacySeal = createHash('sha256').update(JSON.stringify(legacyRepresentation)).digest('hex');
    expect(coManagedArchiveManifestHash(archiveIdentity, legacy)).toBe(legacySeal);

    const failure = { evidenceId: 'evidence-1', attachmentId: 'attachment-1', status: 'retention_failed' as const, reason: 'source_download_failed' as const };
    const reordered = { reason: failure.reason, status: failure.status, attachmentId: failure.attachmentId, evidenceId: failure.evidenceId };
    expect(coManagedArchiveManifestHash(archiveIdentity, { ...legacy, retentionFailures: [failure] }))
      .toBe(coManagedArchiveManifestHash(archiveIdentity, { ...legacy, retentionFailures: [reordered] }));
  });
});
