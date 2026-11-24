import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

// A tiny in-memory stand-in for tenantDb: enough query surface for the engine,
// with the tenant constraint applied to every table the way the real one does.
const store = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, tenant: 'tenant-1', seq: 0 }));

function query(name: string) {
  const conditions: Array<(row: Row) => boolean> = [(row) => row.tenant === store.tenant];
  const sorts: Array<(a: Row, b: Row) => number> = [];
  const rows = () => {
    const matched = (store.tables[name] ??= []).filter((row) => conditions.every((fn) => fn(row)));
    return sorts.length ? matched.sort((a, b) => sorts.reduce((acc, cmp) => acc || cmp(a, b), 0)) : matched;
  };
  const q: any = {
    where(a: any, b?: any) {
      if (typeof a === 'string') conditions.push((row) => row[a] === b);
      else for (const [k, v] of Object.entries(a)) conditions.push((row) => row[k] === v);
      return q;
    },
    whereNull(col: string) { conditions.push((row) => row[col] == null); return q; },
    whereIn(col: string, values: any[]) { conditions.push((row) => values.includes(row[col])); return q; },
    forUpdate() { return q; },
    orderBy(col: string, dir: 'asc' | 'desc' = 'asc') {
      sorts.push((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
      return q;
    },
    first: async () => rows()[0],
    update: (patch: Row) => {
      const matched = rows();
      matched.forEach((row) => Object.assign(row, patch));
      const done: any = Promise.resolve(matched.length);
      done.returning = async () => matched;
      return done;
    },
    insert: (input: Row | Row[]) => {
      const created = (Array.isArray(input) ? input : [input]).map((row) => ({
        ...(name === 'opportunity_evidence' ? { evidence_id: `ev-${++store.seq}`, corrected_at: null } : { citation_id: `ci-${++store.seq}` }),
        ...row,
      }));
      (store.tables[name] ??= []).push(...created);
      const done: any = Promise.resolve(created.length);
      done.returning = async () => created;
      return done;
    },
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
const published = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('../src/lib/opportunityEvents', () => ({ publishOpportunityEventAfterCommit: published.publish }));
vi.mock('../src/models/opportunityModel', () => ({
  OpportunityModel: {
    getById: async () => store.tables.opportunities[0],
    update: async (_t: unknown, _tn: string, _id: string, patch: Row) => Object.assign(store.tables.opportunities[0], patch),
  },
}));

import {
  OpportunityDeclarationError,
  OpportunityEvidenceRefError,
  amendDeclaration,
  assertRefBelongsToOpportunity,
  correctEvidence,
  declareStage,
  declareStageFromStep,
} from '../src/lib/stageEngine';

const db = { table: (name: string) => query(name) } as any;
const trx = {} as any;
const activeDeclarations = (checkpoint: string) =>
  store.tables.opportunity_evidence.filter((row) => row.checkpoint === checkpoint && !row.corrected_at && row.source === 'user_declared');
const citationsOf = (evidenceId: string) =>
  store.tables.opportunity_evidence_citations.filter((row) => row.evidence_id === evidenceId).sort((a, b) => a.position - b.position).map((row) => `${row.ref_type}:${row.ref_id}`);
const doc = (id: string) => ({ type: 'document' as const, id });
const interaction = (id: string) => ({ type: 'interaction' as const, id });

beforeEach(() => {
  store.seq = 0;
  published.publish.mockClear();
  store.tenant = 'tenant-1';
  store.tables = {
    opportunities: [{ tenant: 'tenant-1', opportunity_id: 'opp-1', client_id: 'c1', status: 'open', stage: 'identified' }],
    opportunity_evidence: [],
    opportunity_evidence_citations: [],
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

describe('declareStage content', () => {
  it('stores the note on the row and the citations in the order given, and moves the stage', async () => {
    await declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1', { note: '  Call went well  ', citations: [doc('doc-2'), interaction('int-mine'), doc('doc-1')] });
    const [row] = activeDeclarations('qualified');
    expect(row).toMatchObject({ source: 'user_declared', detail: 'Call went well', ref_type: null, ref_id: null });
    expect(citationsOf(row.evidence_id)).toEqual(['document:doc-2', 'interaction:int-mine', 'document:doc-1']);
    expect(store.tables.opportunities[0].stage).toBe('qualified');
  });

  it('stores a NULL note, not the old placeholder, when none is given', async () => {
    await declareStage(trx, 'tenant-1', 'opp-1', 'assessment', 'user-1');
    expect(activeDeclarations('assessment')[0].detail).toBeNull();
    await declareStage(trx, 'tenant-1', 'opp-1', 'proposed', 'user-1', { note: '   ' });
    expect(activeDeclarations('proposed')[0].detail).toBeNull();
  });

  it('refuses the whole write when any one citation is bad, and writes nothing', async () => {
    await expect(
      declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1', { note: 'x', citations: [doc('doc-1'), interaction('int-other-deal')] }),
    ).rejects.toBeInstanceOf(OpportunityEvidenceRefError);
    await expect(
      declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1', { citations: [doc('doc-1'), { type: 'quote', id: 'q' } as any] }),
    ).rejects.toBeInstanceOf(OpportunityEvidenceRefError);
    expect(store.tables.opportunity_evidence).toHaveLength(0);
    expect(store.tables.opportunity_evidence_citations).toHaveLength(0);
    expect(store.tables.opportunities[0].stage).toBe('identified');
  });

  it('stores a repeated (type, id) once and refuses more than 25 sources', async () => {
    await declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1', { citations: [doc('doc-1'), doc('doc-1'), interaction('int-mine'), doc('doc-1')] });
    expect(citationsOf(activeDeclarations('qualified')[0].evidence_id)).toEqual(['document:doc-1', 'interaction:int-mine']);

    const many = Array.from({ length: 26 }, (_, i) => doc(`doc-${i}`));
    const refusal = await amendDeclaration(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1', { citations: many }).catch((error) => error);
    expect(refusal).toBeInstanceOf(OpportunityDeclarationError);
    expect(refusal.code).toBe('too_many_citations');
    expect(store.tables.opportunity_evidence).toHaveLength(1);
  });

  it('with no content leaves an existing cited declaration alone', async () => {
    await declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1', { note: 'Kept', citations: [doc('doc-1')] });
    await declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-2');
    expect(store.tables.opportunity_evidence).toHaveLength(1);
    expect(store.tables.opportunity_evidence[0].corrected_at).toBeNull();
    expect(activeDeclarations('qualified')[0].detail).toBe('Kept');
  });

  it('moving back to a stage keeps that stage\'s declaration and corrects the ones above', async () => {
    await declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1', { note: 'Q note' });
    await declareStage(trx, 'tenant-1', 'opp-1', 'proposed', 'user-1', { note: 'P note' });
    await declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1');
    expect(activeDeclarations('qualified')[0].detail).toBe('Q note');
    expect(activeDeclarations('proposed')).toHaveLength(0);
    expect(store.tables.opportunities[0].stage).toBe('qualified');
  });
});

describe('declaration patch semantics', () => {
  const seed = () => declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1', { note: 'Original', citations: [doc('doc-1')] });
  const amend = (content: any) => amendDeclaration(trx, 'tenant-1', 'opp-1', 'qualified', 'user-2', content);

  it('an undefined note keeps the note while citations change', async () => {
    await seed();
    await amend({ citations: [doc('doc-2'), interaction('int-mine')] });
    const [live] = activeDeclarations('qualified');
    expect(live.detail).toBe('Original');
    expect(citationsOf(live.evidence_id)).toEqual(['document:doc-2', 'interaction:int-mine']);
  });

  it('undefined citations keep the sources while the note changes', async () => {
    await seed();
    await amend({ note: 'Rewritten' });
    const [live] = activeDeclarations('qualified');
    expect(live.detail).toBe('Rewritten');
    expect(citationsOf(live.evidence_id)).toEqual(['document:doc-1']);
  });

  it('null or empty note and an empty citation list clear', async () => {
    await seed();
    await amend({ note: null });
    expect(activeDeclarations('qualified')[0].detail).toBeNull();
    expect(citationsOf(activeDeclarations('qualified')[0].evidence_id)).toEqual(['document:doc-1']);
    await amend({ citations: [] });
    expect(citationsOf(activeDeclarations('qualified')[0].evidence_id)).toEqual([]);
    await seed();
    await amend({ note: '' });
    expect(activeDeclarations('qualified')[0].detail).toBeNull();
  });

  it('identical content writes nothing', async () => {
    await seed();
    const before = JSON.stringify(store.tables);
    await amend({ note: 'Original', citations: [doc('doc-1')] });
    await amend({ note: '  Original ' });
    await amend({});
    expect(JSON.stringify(store.tables)).toBe(before);
  });

  it('a changed declaration supersedes the live row, keeps recorded_at and recorded_by, and records the editor on the old row', async () => {
    await seed();
    store.tables.opportunity_evidence[0].recorded_at = '2026-01-02T03:04:05.000Z';
    await amend({ note: 'Changed' });
    const live = activeDeclarations('qualified');
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ recorded_at: '2026-01-02T03:04:05.000Z', recorded_by: 'user-1', detail: 'Changed' });
    const old = store.tables.opportunity_evidence[0];
    expect(old).toMatchObject({ correction_note: 'Superseded by a new declaration', corrected_by: 'user-2' });
    expect(old.corrected_at).toBeTruthy();
  });
});

describe('amendDeclaration', () => {
  it('does not move the deal, correct other checkpoints, or publish a stage change', async () => {
    await declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1', { note: 'Q' });
    await declareStage(trx, 'tenant-1', 'opp-1', 'proposed', 'user-1', { note: 'P' });
    published.publish.mockClear();
    const before = store.tables.opportunities[0].stage;
    await amendDeclaration(trx, 'tenant-1', 'opp-1', 'qualified', 'user-2', { note: 'Q2', citations: [doc('doc-1')] });
    expect(store.tables.opportunities[0].stage).toBe(before);
    expect(activeDeclarations('proposed')).toHaveLength(1);
    expect(published.publish).not.toHaveBeenCalled();
  });

  it('refuses a checkpoint that has not been reached and the won checkpoint, with typed errors', async () => {
    const unreached = await amendDeclaration(trx, 'tenant-1', 'opp-1', 'verbal', 'user-1', { note: 'x' }).catch((error) => error);
    expect(unreached).toBeInstanceOf(OpportunityDeclarationError);
    expect(unreached.code).toBe('checkpoint_not_reached');
    const won = await amendDeclaration(trx, 'tenant-1', 'opp-1', 'won', 'user-1', { note: 'x' }).catch((error) => error);
    expect(won.code).toBe('checkpoint_not_amendable');
    expect(store.tables.opportunity_evidence).toHaveLength(0);
  });

  it('inserts a user declaration beside system evidence, never editing the system row', async () => {
    store.tables.opportunity_evidence.push({ evidence_id: 'sys-1', tenant: 'tenant-1', opportunity_id: 'opp-1', checkpoint: 'proposed', source: 'system', ref_type: 'quote', ref_id: 'q-1', detail: 'Quote sent', corrected_at: null, recorded_at: '2026-02-01T00:00:00.000Z' });
    await amendDeclaration(trx, 'tenant-1', 'opp-1', 'proposed', 'user-2', { note: 'Spoke to them', citations: [doc('doc-1')] });
    expect(store.tables.opportunity_evidence).toHaveLength(2);
    expect(store.tables.opportunity_evidence[0]).toMatchObject({ evidence_id: 'sys-1', corrected_at: null, detail: 'Quote sent' });
    expect(activeDeclarations('proposed')[0]).toMatchObject({ recorded_by: 'user-2', detail: 'Spoke to them' });
  });

  it('writes nothing for an empty amendment of a system-only checkpoint', async () => {
    store.tables.opportunity_evidence.push({ evidence_id: 'sys-1', tenant: 'tenant-1', opportunity_id: 'opp-1', checkpoint: 'proposed', source: 'system', corrected_at: null });
    await amendDeclaration(trx, 'tenant-1', 'opp-1', 'proposed', 'user-2', {});
    expect(store.tables.opportunity_evidence).toHaveLength(1);
  });

  it('works on a closed opportunity', async () => {
    await declareStage(trx, 'tenant-1', 'opp-1', 'verbal', 'user-1', { note: 'V' });
    Object.assign(store.tables.opportunities[0], { status: 'won', stage: 'won' });
    await amendDeclaration(trx, 'tenant-1', 'opp-1', 'verbal', 'user-2', { note: 'V edited' });
    expect(activeDeclarations('verbal')[0].detail).toBe('V edited');
    expect(store.tables.opportunities[0].stage).toBe('won');
  });
});

describe('declareStageFromStep', () => {
  it('seeds the step title as the note when the checkpoint has no declaration', async () => {
    await declareStageFromStep(trx, 'tenant-1', 'opp-1', 'assessment', 'user-1', 'Run the assessment call');
    expect(activeDeclarations('assessment')[0].detail).toBe('Run the assessment call');
  });

  it('leaves an existing declaration, note and sources alike, alone', async () => {
    await declareStage(trx, 'tenant-1', 'opp-1', 'assessment', 'user-1', { note: 'Written by a person', citations: [doc('doc-1')] });
    await declareStageFromStep(trx, 'tenant-1', 'opp-1', 'assessment', 'user-1', 'Run the assessment call');
    expect(store.tables.opportunity_evidence).toHaveLength(1);
    expect(activeDeclarations('assessment')[0].detail).toBe('Written by a person');
    expect(citationsOf(activeDeclarations('assessment')[0].evidence_id)).toEqual(['document:doc-1']);
  });
});

describe('correctEvidence on a declaration', () => {
  it('still works', async () => {
    await declareStage(trx, 'tenant-1', 'opp-1', 'qualified', 'user-1', { citations: [doc('doc-1')] });
    const id = store.tables.opportunity_evidence[0].evidence_id;
    const corrected = await correctEvidence(trx, 'tenant-1', id, 'Wrong deal', 'user-1');
    expect(corrected.corrected_at).toBeTruthy();
    expect(store.tables.opportunities[0].stage).toBe('identified');
  });
});
