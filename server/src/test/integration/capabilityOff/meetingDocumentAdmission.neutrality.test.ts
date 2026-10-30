import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Meeting-document admission ahead of the shared document engine (documentActions wrapper).
 * psa tenants get their candidate set back untouched with no SQL and no provider; a served
 * workspace only ever loses documents (deny-only), and the admitting credential is re-checked.
 */
const session = vi.hoisted(() => ({ current: null as any, apiKeyOverride: null as any }));
vi.mock('@alga-psa/auth', () => ({
  getSession: async () => session.current,
  getApiKeyUserOverride: () => session.apiKeyOverride,
}));

import { registerCapabilityParticipation } from '@alga-psa/core/capability';
import { clearCapabilityCache, resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import {
  admitMeetingDocumentsForBrowser,
  meetingDocumentsSeam,
} from '../../../../../packages/documents/src/lib/meetingDocumentAdmission';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = { user_id: '33333333-3333-4333-8333-333333333333', tenant: TENANT } as any;
const docs = [{ document_id: 'doc-a' }, { document_id: 'doc-transcript' }, { document_id: 'doc-b' }];

function recordingTrx() {
  const touched: string[] = [];
  const trx = new Proxy(function () {}, {
    get(_t, prop) { touched.push(String(prop)); return () => { throw new Error(`unexpected SQL via ${String(prop)}`); }; },
    apply() { touched.push('call'); throw new Error('unexpected SQL'); },
  });
  return { trx: trx as any, touched };
}

describe('meeting-document admission', () => {
  const provider = { admitMeetingDocuments: vi.fn() };

  beforeEach(() => {
    delete process.env.FORCE_CAPABILITIES;
    resetCapabilityRegistry();
    meetingDocumentsSeam.reset();
    provider.admitMeetingDocuments.mockReset();
    meetingDocumentsSeam.register(() => provider);
    session.current = { session_id: 'session-1', user: { id: USER.user_id, tenant: TENANT, user_type: 'internal' } };
    session.apiKeyOverride = null;
  });
  afterEach(() => {
    delete process.env.FORCE_CAPABILITIES;
    meetingDocumentsSeam.reset();
    resetCapabilityRegistry();
  });

  it.each([
    ['Kansas (no participation resolver)', () => {}],
    ['Emerald (flag on, no entitlement)', () => registerCapabilityParticipation('co-managed', async () => new Set<string>())],
    ['kill switch on a participating tenant', () => {
      registerCapabilityParticipation('co-managed', async ({ tenantIds }) => new Set(tenantIds));
      process.env.FORCE_CAPABILITIES = 'co-managed:off';
      clearCapabilityCache();
    }],
  ])('%s: returns the same documents, no provider, no SQL', async (_label, arrange) => {
    arrange();
    const { trx, touched } = recordingTrx();
    const result = await admitMeetingDocumentsForBrowser(trx, TENANT, USER, docs);
    expect(result.documents).toBe(docs);
    expect(result.assertCurrent).toBeUndefined();
    expect(provider.admitMeetingDocuments).not.toHaveBeenCalled();
    expect(touched).toEqual([]);
  });

  it('a served workspace withholds denied artifact documents and keeps the rest in order', async () => {
    registerCapabilityParticipation('co-managed', async ({ tenantIds }) => new Set(tenantIds));
    const assertCurrent = vi.fn(async () => {});
    provider.admitMeetingDocuments.mockImplementation(async (_db, _tenant, ids, identify) => {
      expect(ids).toEqual(['doc-a', 'doc-transcript', 'doc-b']);
      expect(await identify()).toEqual({ kind: 'session', tenant: TENANT, userId: USER.user_id, sessionId: 'session-1' });
      return { handled: true, deniedDocumentIds: ['doc-transcript'], assertCurrent };
    });
    const result = await admitMeetingDocumentsForBrowser({} as any, TENANT, USER, docs);
    expect(result.documents.map(d => d.document_id)).toEqual(['doc-a', 'doc-b']);
    expect(result.assertCurrent).toBe(assertCurrent);
  });

  it('a served tenant that is not a co-managed workspace falls through unchanged', async () => {
    registerCapabilityParticipation('co-managed', async ({ tenantIds }) => new Set(tenantIds));
    provider.admitMeetingDocuments.mockResolvedValue({ handled: false });
    const result = await admitMeetingDocumentsForBrowser({} as any, TENANT, USER, docs);
    expect(result.documents).toBe(docs);
  });

  it('an API-key override is never accepted as the browser actor', async () => {
    registerCapabilityParticipation('co-managed', async ({ tenantIds }) => new Set(tenantIds));
    session.apiKeyOverride = { user_id: USER.user_id };
    provider.admitMeetingDocuments.mockImplementation(async (_db, _tenant, _ids, identify) => identify());
    await expect(admitMeetingDocumentsForBrowser({} as any, TENANT, USER, docs)).rejects.toMatchObject({
      name: 'CoManagedSharedWorkError', code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN',
    });
  });

  it('an empty candidate set never consults the gate', async () => {
    registerCapabilityParticipation('co-managed', async () => { throw new Error('gate consulted'); });
    expect((await admitMeetingDocumentsForBrowser({} as any, TENANT, USER, [])).documents).toEqual([]);
  });
});
