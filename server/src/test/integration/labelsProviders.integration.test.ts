/**
 * alga-2026-0002683 C2 - integration tests against real storage and real authorization:
 *   T-asset-link  real `asset_associations` rows -> the linked asset's tag + serial suffix on a ticket tag
 *   T-resolve     explicit template > class default > standard; class isolation; no tenant-scope write
 *   T-skip        a mixed batch (readable / restricted / missing / cross-tenant) skips and counts, order kept
 *
 * Providers, RBAC, the authorization kernel (including a published bundle that narrows one user to a
 * client), template storage and the default-assignment action are all real. Rendering is captured (not
 * the subject here; the render path is covered by labelsPrintNoSideEffects). The only mocks are the event
 * bus, next/cache, and `withAuth`, which becomes "run the handler as this user inside their tenant context"
 * exactly as the real wrapper does after it has resolved the session.
 */
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { asRequest, buildRealLabelDeps, seedLabelWorld, type LabelWorld } from './labelsFixtures';

const auth = vi.hoisted(() => {
  process.env.DB_NAME_SERVER = process.env.TEST_DB_NAME || 'test_database';
  return { user: null as null | { user_id: string; tenant: string } };
});
const published = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: published, publishWorkflowEvent: published }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  const { runWithTenant } = await import('@alga-psa/db');
  return {
    ...actual,
    withAuth:
      (fn: (user: unknown, ctx: { tenant: string }, ...args: unknown[]) => unknown) =>
      (...args: unknown[]) =>
        runWithTenant(auth.user!.tenant, async () => fn(auth.user, { tenant: auth.user!.tenant }, ...args)),
  };
});

let db: Knex;
let world: LabelWorld;
const storageDir = path.join(os.tmpdir(), `c2-label-providers-${process.pid}`);

const ctx = (user: LabelWorld['tech']) => ({ tenant: world.tenant, user, baseUrl: 'https://psa.test' });

describe('C2 label integration (real providers, real storage)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: true });
    world = await seedLabelWorld(db, storageDir);
  }, 240_000);
  afterAll(async () => {
    await db?.destroy();
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  describe('T-asset-link', () => {
    const parts = async (user: LabelWorld['tech'], ticketIds: string[], chosen: Record<string, string> = {}) => {
      const { getTicketLinkedAssetLabelParts } = await import('@alga-psa/assets/lib/ticketLinkedAssetLabels');
      // Keyed by ticket for readability: one subject per ticket, carrying that ticket's pick.
      const subjects = ticketIds.map((id) => ({ recordId: id, ...(chosen[id] ? { linkedAssetId: chosen[id] } : {}) }));
      const list = await asRequest(world.tenant, () => getTicketLinkedAssetLabelParts(ctx(user), subjects));
      return Object.fromEntries(ticketIds.map((id, i) => [id, list[i]]));
    };

    it('one readable linked asset gives its tag and the last four of the serial', async () => {
      const r = await parts(world.tech, [world.tickets.withOneAsset, world.tickets.a1]);
      expect(r[world.tickets.withOneAsset]).toEqual({ assetId: world.assets.a1, assetTag: 'TAG-A1', serialSuffix: '5678', custodyLocation: null, nextAction: null });
      expect(r[world.tickets.a1]).toBeNull(); // no link at all
      expect(JSON.stringify(r)).not.toContain(world.serials.a1);
    });

    it('a serial shorter than eight characters yields no suffix', async () => {
      const r = await parts(world.tech, [world.tickets.withShortSerial]);
      expect(r[world.tickets.withShortSerial]).toEqual({ assetId: world.assets.a2, assetTag: 'TAG-A2', serialSuffix: null, custodyLocation: null, nextAction: null });
    });

    it('two readable linked assets and no choice give null; a valid choice picks that one', async () => {
      const t = world.tickets.withTwoAssets;
      expect((await parts(world.tech, [t]))[t]).toBeNull();
      expect((await parts(world.tech, [t], { [t]: world.assets.a3 }))[t]).toMatchObject({
        assetId: world.assets.a3,
        assetTag: 'TAG-A3',
        serialSuffix: '0000',
      });
    });

    it('an unreadable linked asset contributes nothing', async () => {
      // Only link is the client-B asset the restricted user cannot read.
      expect((await parts(world.restricted, [world.tickets.withDeniedAsset]))[world.tickets.withDeniedAsset]).toBeNull();
      // Two links, one unreadable: the single readable one is used for the restricted user, none for the tech.
      const t = world.tickets.withMixedAssets;
      expect((await parts(world.restricted, [t]))[t]).toMatchObject({ assetId: world.assets.a1 });
      expect((await parts(world.tech, [t]))[t]).toBeNull();
      // Choosing the unreadable one does not reveal it.
      expect((await parts(world.restricted, [t], { [t]: world.assets.b1 }))[t]).toMatchObject({ assetId: world.assets.a1 });
      // No asset:read at all.
      expect((await parts(world.noPerm, [world.tickets.withOneAsset]))[world.tickets.withOneAsset]).toBeNull();
    });

    it('a linkedAssetId that is not linked to the ticket is ignored', async () => {
      const one = world.tickets.withOneAsset;
      const two = world.tickets.withTwoAssets;
      // Unlinked asset chosen on a single-asset ticket: falls back to the single linked asset.
      expect((await parts(world.tech, [one], { [one]: world.assets.unlinked }))[one]).toMatchObject({ assetId: world.assets.a1 });
      // ...and on a two-asset ticket it does not pick anything.
      expect((await parts(world.tech, [two], { [two]: world.assets.unlinked }))[two]).toBeNull();
      // Another tenant's asset id is equally inert.
      expect((await parts(world.tech, [two], { [two]: world.assets.foreign }))[two]).toBeNull();
    });

    it('reaches the printed ticket view model through printLabels (suffix only, never the serial)', async () => {
      const items: Array<{ viewModel: Record<string, unknown> }> = [];
      const deps = await buildRealLabelDeps({
        renderPdf: async (_t: string, captured: typeof items) => {
          items.push(...captured);
          return { pdf: Buffer.from('%PDF'), labels: captured.length, sheets: captured.length };
        },
      });
      const { printLabels } = await import('../../lib/labels/printLabels');
      const result = await asRequest(world.tenant, () =>
        printLabels(deps, ctx(world.tech), { labelClass: 'ticket-work-tag', labels: [{ recordId: world.tickets.withOneAsset }] })
      );
      expect(result).toMatchObject({ ok: true, skipped: 0 });
      expect(items[0].viewModel).toMatchObject({ secondaryIdentifier: 'TAG-A1', serialSuffix: '5678' });
      expect(JSON.stringify(items)).not.toContain(world.serials.a1);
    });
  });

  describe('T-resolve', () => {
    const resolve = async (labelClass: 'ticket-work-tag' | 'asset-identity', templateId: string | null = null) => {
      const { resolveLabelTemplateForTenant } = await import('@alga-psa/billing/services');
      return asRequest(world.tenant, () => resolveLabelTemplateForTenant(world.tenant, labelClass, templateId));
    };
    const customAst = async (labelClass: string | null) => {
      const { getStandardLabelTemplateAstByCode } = await import('@alga-psa/billing/lib/label-template-ast/standardTemplates');
      const ast = JSON.parse(JSON.stringify(getStandardLabelTemplateAstByCode('standard-ticket-work-tag')));
      ast.metadata = { ...(ast.metadata ?? {}) };
      if (labelClass) ast.metadata.labelClass = labelClass;
      else delete ast.metadata.labelClass;
      return ast;
    };
    const saveCustom = async (name: string, labelClass: string | null) => {
      const { saveCustomDocumentTemplate } = await import('@alga-psa/billing/lib/document-templates/storage');
      const template_id = randomUUID();
      await saveCustomDocumentTemplate(db, world.tenant, 'work-tag', {
        template_id,
        name,
        version: 1,
        templateAst: await customAst(labelClass),
      });
      return template_id;
    };
    const setDefault = async (payload: { templateSource: 'standard'; standardTemplateCode: string } | { templateSource: 'custom'; templateId: string }) => {
      auth.user = world.tech as never;
      const { setDefaultDocumentTemplate } = await import('../../../../packages/billing/src/actions/documentTemplateActions');
      return (setDefaultDocumentTemplate as unknown as (documentType: string, payload: unknown) => Promise<{ success?: boolean }>)(
        'work-tag',
        payload
      );
    };

    it('explicit template beats the class default, which beats the standard template', async () => {
      // Test order is shuffled: a standard default may already be set, so only the template is asserted here.
      expect(await resolve('ticket-work-tag')).toMatchObject({ ok: true, templateCode: 'standard-ticket-work-tag' });

      const defaultId = await saveCustom('Ticket default', 'ticket-work-tag');
      const explicitId = await saveCustom('Ticket explicit', 'ticket-work-tag');
      expect(await setDefault({ templateSource: 'custom', templateId: defaultId })).toMatchObject({ success: true });

      expect(await resolve('ticket-work-tag')).toMatchObject({ ok: true, templateCode: defaultId, source: 'class-default' });
      expect(await resolve('ticket-work-tag', explicitId)).toMatchObject({ ok: true, templateCode: explicitId, source: 'explicit' });
      expect(await resolve('ticket-work-tag', 'standard-ticket-work-tag')).toMatchObject({
        ok: true,
        templateCode: 'standard-ticket-work-tag',
        source: 'explicit',
      });
    });

    it('a template of the wrong class is refused, and printLabels answers 400', async () => {
      const assetCustom = await saveCustom('Asset custom', 'asset-identity');
      expect(await resolve('ticket-work-tag', assetCustom)).toMatchObject({ ok: false });
      expect(await resolve('ticket-work-tag', 'standard-asset-label')).toMatchObject({ ok: false });
      expect(await resolve('asset-identity', assetCustom)).toMatchObject({ ok: true, source: 'explicit' });

      const deps = await buildRealLabelDeps({ renderPdf: async () => ({ pdf: Buffer.from('%PDF'), labels: 1, sheets: 1 }) });
      const { printLabels } = await import('../../lib/labels/printLabels');
      const result = await asRequest(world.tenant, () =>
        printLabels(deps, ctx(world.tech), { labelClass: 'ticket-work-tag', labels: [{ recordId: world.tickets.a1 }], templateId: assetCustom })
      );
      expect(result).toMatchObject({ ok: false, status: 400 });
    });

    it('a custom template with no labelClass acts as a ticket template', async () => {
      const legacy = await saveCustom('Legacy no class', null);
      expect(await resolve('ticket-work-tag', legacy)).toMatchObject({ ok: true, source: 'explicit' });
      expect(await resolve('asset-identity', legacy)).toMatchObject({ ok: false });
    });

    it('setting the asset default leaves ticket printing unchanged; a class default writes no tenant-scope assignment', async () => {
      // Self-contained: vitest shuffles test order, so do not rely on another test having set the ticket default.
      expect(await setDefault({ templateSource: 'standard', standardTemplateCode: 'standard-ticket-work-tag' })).toMatchObject({
        success: true,
      });
      const ticketBefore = await resolve('ticket-work-tag');
      expect(await setDefault({ templateSource: 'standard', standardTemplateCode: 'standard-asset-label-code128' })).toMatchObject({
        success: true,
      });
      expect(await resolve('asset-identity')).toMatchObject({ ok: true, templateCode: 'standard-asset-label-code128', source: 'class-default' });
      expect(await resolve('ticket-work-tag')).toEqual(ticketBefore);

      const rows = await db('document_template_assignments')
        .where({ tenant: world.tenant, document_type: 'work-tag' })
        .select('scope_type', 'scope_key', 'scope_id');
      expect(rows.filter((r) => r.scope_type === 'tenant')).toEqual([]);
      expect(rows.map((r) => `${r.scope_type}:${r.scope_key}`).sort()).toEqual(['label_class:asset-identity', 'label_class:ticket-work-tag']);
      expect(rows.every((r) => r.scope_id === null)).toBe(true);
    });
  });

  describe('T-skip: mixed batches against the real providers', () => {
    const capture = async () => {
      const printed: string[] = [];
      const deps = await buildRealLabelDeps({
        renderPdf: async (_t: string, items: Array<{ viewModel: { recordId: string } }>) => {
          printed.push(...items.map((i) => i.viewModel.recordId));
          return { pdf: Buffer.from('%PDF'), labels: items.length, sheets: items.length };
        },
      });
      return { deps, printed };
    };
    const run = async (user: LabelWorld['tech'], labelClass: string, ids: string[]) => {
      const { deps, printed } = await capture();
      const { printLabels } = await import('../../lib/labels/printLabels');
      const result = await asRequest(world.tenant, () => printLabels(deps, ctx(user), { labelClass, labels: ids.map((recordId) => ({ recordId })) }));
      return { result, printed };
    };

    it('tickets: readable, restricted, missing and cross-tenant ids -> 2 labels, skipped 3, order kept', async () => {
      const t = world.tickets;
      const { result, printed } = await run(world.restricted, 'ticket-work-tag', [t.a2, t.b1, randomUUID(), t.foreign, t.a1]);
      expect(result).toMatchObject({ ok: true, labels: 2, skipped: 3 });
      expect(printed).toEqual([t.a2, t.a1]);
      // Nothing about a skipped record is in the response (only the PDF bytes and counts).
      const body = JSON.stringify({ ...(result as object), pdf: undefined });
      for (const secret of ['Client B ticket', 'LBL-6', 'Foreign ticket', 'LBL-F', t.b1, t.foreign]) {
        expect(body).not.toContain(secret);
      }
    });

    it('assets: readable, restricted, missing and cross-tenant ids -> 2 labels, skipped 3, order kept', async () => {
      const a = world.assets;
      const { result, printed } = await run(world.restricted, 'asset-identity', [a.a3, a.b1, randomUUID(), a.foreign, a.a1]);
      expect(result).toMatchObject({ ok: true, labels: 2, skipped: 3 });
      expect(printed).toEqual([a.a3, a.a1]);
      const body = JSON.stringify({ ...(result as object), pdf: undefined });
      for (const secret of ['TAG-B1', 'TAG-F1', a.b1, a.foreign]) {
        expect(body).not.toContain(secret);
      }
    });

    it('mixed classes in one request: order kept, skips counted per subject, templateId is a 400', async () => {
      const t = world.tickets;
      const a = world.assets;
      const { deps, printed } = await capture();
      const { printLabels } = await import('../../lib/labels/printLabels');
      const labels = [
        { labelClass: 'ticket-work-tag', recordId: t.a2 },
        { labelClass: 'asset-identity', recordId: a.a3 },
        { labelClass: 'ticket-work-tag', recordId: t.foreign },
        { labelClass: 'asset-identity', recordId: a.foreign },
        { labelClass: 'ticket-work-tag', recordId: t.a1 },
      ];
      const result = await asRequest(world.tenant, () => printLabels(deps, ctx(world.tech), { labels }));
      expect(result).toMatchObject({ ok: true, labels: 3, skipped: 2 });
      expect(printed).toEqual([t.a2, a.a3, t.a1]);
      const refused = await asRequest(world.tenant, () => printLabels(deps, ctx(world.tech), { labels, templateId: 'standard-ticket-work-tag' }));
      expect(refused).toMatchObject({ ok: false, status: 400 });
    });

    it('a user who can read 2 of 3 gets 2 labels and skipped 1', async () => {
      const t = world.tickets;
      const { result, printed } = await run(world.tech, 'ticket-work-tag', [t.a1, t.foreign, t.a2]);
      expect(result).toMatchObject({ ok: true, labels: 2, skipped: 1 });
      expect(printed).toEqual([t.a1, t.a2]);
    });

    it('everything unreadable is the same uniform 404 whatever the reason', async () => {
      const t = world.tickets;
      const reasons = await Promise.all([
        run(world.restricted, 'ticket-work-tag', [t.b1]), // record-level deny
        run(world.tech, 'ticket-work-tag', [randomUUID()]), // missing
        run(world.tech, 'ticket-work-tag', [t.foreign]), // other tenant
        run(world.noPerm, 'ticket-work-tag', [t.a1]), // no ticket:read at all
        run(world.restricted, 'ticket-work-tag', [t.b1, t.foreign, randomUUID()]), // all of a batch
      ]);
      for (const { result, printed } of reasons) {
        expect(result).toEqual({ ok: false, status: 404, message: 'Not found.' });
        expect(printed).toEqual([]);
      }
    });
  });
});
