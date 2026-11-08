import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

// A tiny in-memory stand-in for tenantDb: enough query surface for the engine,
// with the tenant constraint applied to every table the way the real one does.
const store = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, tenant: 'tenant-1', seq: 0 }));

function query(name: string) {
  const conditions: Array<(row: Row) => boolean> = [(row) => row.tenant === store.tenant];
  const rows = () => (store.tables[name] ??= []).filter((row) => conditions.every((fn) => fn(row)));
  const q: any = {
    where(a: any, b?: any) {
      if (typeof a === 'string') conditions.push((row) => row[a] === b);
      else for (const [k, v] of Object.entries(a)) conditions.push((row) => row[k] === v);
      return q;
    },
    whereNull(col: string) { conditions.push((row) => row[col] == null); return q; },
    whereIn(col: string, values: any[]) { conditions.push((row) => values.includes(row[col])); return q; },
    forUpdate() { return q; },
    first: async () => rows()[0],
    update: (patch: Row) => {
      const matched = rows();
      matched.forEach((row) => Object.assign(row, patch));
      const done: any = Promise.resolve(matched.length);
      done.returning = async () => matched;
      return done;
    },
    insert: (row: Row) => ({
      returning: async () => {
        const created = { evidence_id: `ev-${++store.seq}`, corrected_at: null, ...row };
        (store.tables[name] ??= []).push(created);
        return [created];
      },
    }),
    then: (resolve: any, reject: any) => Promise.resolve(rows()).then(resolve, reject),
  };
  return q;
}

vi.mock('@alga-psa/db', () => ({
  tenantDb: (_trx: unknown, tenant: string) => {
    store.tenant = tenant;
    return { table: (name: string) => query(name) };
  },
  registerAfterCommit: vi.fn(),
}));
vi.mock('../src/lib/opportunityEvents', () => ({ publishOpportunityEventAfterCommit: vi.fn() }));
vi.mock('../src/models/opportunityModel', () => ({
  OpportunityModel: {
    getById: async () => store.tables.opportunities[0],
    update: async (_t: unknown, _tn: string, _id: string, patch: Row) => Object.assign(store.tables.opportunities[0], patch),
  },
}));

import {
  OpportunityEvidenceRefError,
  assertRefBelongsToOpportunity,
  declareStage,
  correctEvidence,
} from '../src/lib/stageEngine';

const db = { table: (name: string) => query(name) } as any;
const trx = {} as any;
const activeDeclarations = (checkpoint: string) =>
  store.tables.opportunity_evidence.filter((row) => row.checkpoint === checkpoint && !row.corrected_at && row.source === 'user_declared');

beforeEach(() => {
  store.seq = 0;
  store.tenant = 'tenant-1';
  store.tables = {
    opportunities: [{ tenant: 'tenant-1', opportunity_id: 'opp-1', client_id: 'c1', status: 'open', stage: 'identified' }],
    opportunity_evidence: [],
    interactions: [
      { tenant: 'tenant-1', interaction_id: 'int-mine', opportunity_id: 'opp-1' },
      { tenant: 'tenant-1', interaction_id: 'int-other-deal', opportunity_id: 'opp-2' },
      { tenant: 'tenant-2', interaction_id: 'int-other-tenant', opportunity_id: 'opp-1' },
    ],
    document_associations: [
      { tenant: 'tenant-1', document_id: 'doc-1', entity_type: 'opportunity', entity_id: 'opp-1' },
      { tenant: 'tenant-1', document_id: 'doc-2', entity_type: 'opportunity', entity_id: 'opp-1' },
      { tenant: 'tenant-1', document_id: 'doc-ticket', entity_type: 'ticket', entity_id: 'opp-1' },
      { tenant: 'tenant-2', document_id: 'doc-foreign', entity_type: 'opportunity', entity_id: 'opp-1' },
    ],
  };
});

describe('assertRefBelongsToOpportunity', () => {
  const check = (type: string, id: string, tenant = 'tenant-1') =>
    assertRefBelongsToOpportunity(db, tenant, 'opp-1', { type, id });

  it('accepts this deal\'s interaction and an attached document', async () => {
    await expect(check('interaction', 'int-mine')).resolves.toBeUndefined();
    await expect(check('document', 'doc-1')).resolves.toBeUndefined();
  });

  it('refuses an interaction from another opportunity or another tenant', async () => {
    await expect(check('interaction', 'int-other-deal')).rejects.toBeInstanceOf(OpportunityEvidenceRefError);
    await expect(check('interaction', 'int-other-tenant')).rejects.toBeInstanceOf(OpportunityEvidenceRefError);
  });

  it('refuses an unattached document, one attached to a different entity type, and a cross-tenant association', async () => {
    await expect(check('document', 'doc-unattached')).rejects.toBeInstanceOf(OpportunityEvidenceRefError);
    await expect(check('document', 'doc-ticket')).rejects.toBeInstanceOf(OpportunityEvidenceRefError);
    await expect(check('document', 'doc-foreign')).rejects.toBeInstanceOf(OpportunityEvidenceRefError);
  });

  it.each(['quote', 'contract', 'project', 'schedule_entry', 'bogus'])('refuses %s on a declaration', async (type) => {
    await expect(check(type, 'anything')).rejects.toBeInstanceOf(OpportunityEvidenceRefError);
  });
});

describe('declareStage with a citation', () => {
  it('records the cited document on a user_declared row without changing the source', async () => {
    await declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1', undefined, { type: 'document', id: 'doc-1' });
    const [row] = activeDeclarations('qualified');
    expect(row).toMatchObject({ source: 'user_declared', ref_type: 'document', ref_id: 'doc-1' });
    expect(store.tables.opportunities[0].stage).toBe('qualified');
  });

  it('refuses a foreign source and writes nothing', async () => {
    await expect(
      declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1', undefined, { type: 'interaction', id: 'int-other-deal' }),
    ).rejects.toBeInstanceOf(OpportunityEvidenceRefError);
    expect(store.tables.opportunity_evidence).toHaveLength(0);
    await expect(
      declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1', undefined, { type: 'quote', id: 'q' } as any),
    ).rejects.toBeInstanceOf(OpportunityEvidenceRefError);
  });

  it('supersedes: doc1 then doc2 leaves one live declaration and corrects doc1 with the note', async () => {
    await declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1', undefined, { type: 'document', id: 'doc-1' });
    await declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-2', undefined, { type: 'document', id: 'doc-2' });
    const live = activeDeclarations('qualified');
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ ref_type: 'document', ref_id: 'doc-2' });
    const old = store.tables.opportunity_evidence.find((row) => row.ref_id === 'doc-1')!;
    expect(old).toMatchObject({ correction_note: 'Superseded by a new declaration', corrected_by: 'user-2' });
    expect(old.corrected_at).toBeTruthy();
    expect(store.tables.opportunities[0].stage).toBe('qualified');
  });

  it('declaring the same ref twice leaves a single row', async () => {
    const ref = { type: 'interaction' as const, id: 'int-mine' };
    await declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1', undefined, ref);
    await declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1', undefined, ref);
    expect(store.tables.opportunity_evidence).toHaveLength(1);
    expect(store.tables.opportunity_evidence[0].corrected_at).toBeNull();
  });

  it('a different citation, or none, supersedes in either direction', async () => {
    await declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1');
    await declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1', undefined, { type: 'document', id: 'doc-1' });
    expect(activeDeclarations('qualified')).toHaveLength(1);
    expect(activeDeclarations('qualified')[0].ref_id).toBe('doc-1');
    await declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1');
    expect(activeDeclarations('qualified')).toHaveLength(1);
    expect(activeDeclarations('qualified')[0].ref_id).toBeNull();
  });

  it('system declarations without a ref keep their call shape and write no ref', async () => {
    await declareStage(trx, 'tenant-1', 'opp-1', 'assessment', 'user-1', 'Call completed');
    expect(store.tables.opportunity_evidence).toHaveLength(1);
    expect(store.tables.opportunity_evidence[0]).toMatchObject({ source: 'user_declared', ref_type: null, ref_id: null, detail: 'Call completed' });
  });

  it('correctEvidence still works on a cited row', async () => {
    await declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1', undefined, { type: 'document', id: 'doc-1' });
    const id = store.tables.opportunity_evidence[0].evidence_id;
    const corrected = await correctEvidence(trx, 'tenant-1', id, 'Wrong deal', 'user-1');
    expect(corrected.corrected_at).toBeTruthy();
    expect(store.tables.opportunities[0].stage).toBe('identified');
  });
});
