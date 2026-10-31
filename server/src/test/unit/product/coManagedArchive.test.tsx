// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ARCHIVE_ALLOWED_AUDIENCES, ARCHIVE_EVIDENCE_CLASSES, classifyArchiveCandidate } from '@alga-psa/co-managed';

const actions = vi.hoisted(() => ({ list: vi.fn(), history: vi.fn() }));
vi.mock('@/lib/actions/coManagedArchiveActions', () => ({ listCoManagedArchiveSummaries: actions.list, getCoManagedArchive: actions.history }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const translation = { t: (k: string, o?: any) => (o?.defaultValue ?? k).replace(/\{\{(\w+)\}\}/g, (_m: string, key: string) => String(o?.[key])) };
  const formatters = { formatDate: (d: Date) => d.toISOString().slice(0, 10) };
  return { useTranslation: () => translation, useFormatters: () => formatters };
});

import CoManagedArchive from '@/components/co-managed/CoManagedArchive';

const OP = '33333333-3333-4333-8333-333333333333';
const summary = { operationId: OP, clientName: 'Acme Corp', sealedAt: '2026-10-31T00:00:00.000Z', cutoffAt: '2026-10-30T00:00:00.000Z', evidenceCount: 2, fileCount: 1, excludedCount: 2 };
beforeEach(() => { actions.list.mockReset(); actions.history.mockReset(); });
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
      exclusions: [{ evidenceClass: 'conversation', reason: 'audience_not_allowlisted', count: 1 }, { evidenceClass: 'conversation', reason: 'after_cutoff', count: 1 }] } });
    const { container } = render(<CoManagedArchive />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect(await screen.findByText('shared with IT')).toBeInTheDocument();
    expect(screen.getByText('report.pdf').getAttribute('href')).toBe('/api/co-management/archive-files/44444444-4444-4444-8444-444444444444');
    expect(screen.getByText(/Private to the customer/)).toBeInTheDocument();
    expect(screen.getByText(/After the relationship ended/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/CUSTOMER-PRIVATE|POST-CUTOFF/);
    await waitFor(() => expect(actions.history).toHaveBeenCalledWith({ operationId: OP, page: 0 }));
  });

  it('a refused reader sees a denial, not an empty archive', async () => {
    actions.list.mockResolvedValue({ ok: false, reason: 'denied' });
    render(<CoManagedArchive />);
    expect(await screen.findByText(/do not have permission to view this archive/)).toBeInTheDocument();
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

  it('keeps a time entry (retained class) and excludes it after the cutoff', () => {
    expect(ARCHIVE_EVIDENCE_CLASSES).toContain('time_entry');
    expect(classifyArchiveCandidate({ ...at(before), source_type: 'time_entry', payload: {} }, cutoff)).toEqual({ include: true });
    expect(classifyArchiveCandidate({ ...at(after), source_type: 'time_entry', payload: {} }, cutoff)).toEqual({ include: false, reason: 'after_cutoff' });
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
