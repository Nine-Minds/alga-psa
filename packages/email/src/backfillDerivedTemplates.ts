/**
 * One-shot, re-runnable backfill of derived-template provenance (alga-2026-0002820).
 *
 * Tenant rows the branding tool wrote before provenance existed are frozen copies of a system body
 * of their day. For each tenant row without provenance this tries the current system body and the
 * checked-in catalogue of prior bodies, renders each candidate exactly the way the apply flow
 * wrote it (palette, then brand decoration) and compares it with the row, brand assets normalised
 * away. Only an exact match is stamped; from then on the resolver serves the row as the *current*
 * system template in the tenant's brand. A row that matches nothing is somebody's edit and is left
 * exactly as it is.
 *
 * - Tenant-scoped: every query goes through tenantDb, one tenant at a time.
 * - Idempotent: only rows with no provenance are considered, and a per-tenant marker in
 *   tenant_settings records a finished run so a second run reads nothing (`force` ignores it).
 * - `dryRun` reports what it would stamp and writes neither rows nor marker.
 *
 * Operator entry point: server/scripts/backfill-derived-email-templates.ts
 */

import type { Knex } from 'knex';
import { tenantDb, type TenantDb } from '@alga-psa/db';
import { applyEmailPalette } from './branding/applyEmailPalette';
import { withoutBrandAssets } from './branding/classifyTenantTemplate';
import { STOCK_EMAIL_PALETTE } from './branding/stockPalette';
import type { EmailPaletteTokens } from './branding/types';
import {
  templateSnapshotHash,
  tenantBrandDecorator,
  readTenantBrand,
  type DerivedProvenance,
  type TenantBrand,
} from './derivedTemplates';
import { PRIOR_SYSTEM_BODIES, type PriorSystemBody } from './priorSystemBodies.generated';

export const BACKFILL_MARKER_KEY = 'emailTemplateProvenanceBackfill';

export interface BackfillTenantRow {
  id: number;
  name: string;
  language_code: string | null;
  subject: string;
  html_content: string;
  text_content: string;
}

export interface BackfillSystemRow extends BackfillTenantRow {
  id: number;
}

export interface BackfillMatch {
  /** The current system row the stamped row will follow. */
  systemRow: BackfillSystemRow;
  /** Which body matched: the current one, or the label of a prior one. */
  matchedBody: 'current' | string;
  palette: EmailPaletteTokens;
}

/**
 * Does this untouched-looking row equal some known system body, written by the apply flow?
 * Subject and plain text must match exactly; the HTML is compared after brand assets (logo,
 * attribution, gradient fallback) are normalised away, as the classifier does.
 */
export function matchDerivedRow(
  row: BackfillTenantRow,
  systemRow: BackfillSystemRow,
  priorBodies: readonly PriorSystemBody[],
  palettes: readonly EmailPaletteTokens[],
  brand: TenantBrand,
): BackfillMatch | null {
  const candidates: Array<{ label: 'current' | string; body: PriorSystemBody }> = [
    { label: 'current', body: { label: 'current', ...pickContent(systemRow) } },
    ...priorBodies.map((body) => ({ label: body.label, body })),
  ];

  for (const palette of palettes) {
    for (const { label, body } of candidates) {
      if (body.subject !== row.subject || body.text_content !== row.text_content) continue;
      const decorate = tenantBrandDecorator(brand, palette);
      const rendered = applyEmailPalette(body.html_content, STOCK_EMAIL_PALETTE, palette);
      const expected = decorate ? decorate(rendered) : rendered;
      if (withoutBrandAssets(row.html_content) === withoutBrandAssets(expected)) {
        return { systemRow, matchedBody: label, palette };
      }
    }
  }
  return null;
}

function pickContent(row: BackfillTenantRow) {
  return { subject: row.subject, html_content: row.html_content, text_content: row.text_content };
}

export interface BackfillTenantSummary {
  tenant: string;
  skipped: 'already-run' | null;
  considered: number;
  stamped: Array<{ name: string; language: string; matchedBody: string }>;
  unmatched: number;
}

export interface BackfillOptions {
  /** Only this tenant; default is every tenant. */
  tenant?: string;
  dryRun?: boolean;
  /** Ignore the per-tenant marker (rows with provenance are still never touched). */
  force?: boolean;
  onProgress?: (line: string) => void;
}

export interface BackfillSummary {
  tenants: BackfillTenantSummary[];
  considered: number;
  stamped: number;
  unmatched: number;
}

async function readMarker(db: TenantDb): Promise<unknown> {
  const row = await db.table('tenant_settings').select('settings').first();
  return row?.settings?.[BACKFILL_MARKER_KEY];
}

async function writeMarker(db: TenantDb, knex: Knex | Knex.Transaction, value: Record<string, unknown>): Promise<void> {
  // Citus: one tenant-scoped statement, jsonb_set over the existing blob.
  await db.table('tenant_settings').update({
    settings: knex.raw(
      `jsonb_set(coalesce(settings, '{}'::jsonb), ARRAY[?]::text[], ?::jsonb)`,
      [BACKFILL_MARKER_KEY, JSON.stringify(value)],
    ),
  });
}

export async function backfillDerivedTemplatesForTenant(
  knex: Knex,
  tenant: string,
  options: BackfillOptions = {},
): Promise<BackfillTenantSummary> {
  const summary: BackfillTenantSummary = { tenant, skipped: null, considered: 0, stamped: [], unmatched: 0 };

  await knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenant);

    if (!options.force && (await readMarker(db))) {
      summary.skipped = 'already-run';
      return;
    }

    const rows = await db.table('tenant_email_templates').whereNull('derived_snapshot_hash') as BackfillTenantRow[];
    const systemRows = await db.table('system_email_templates') as BackfillSystemRow[];
    const systemByKey = new Map(systemRows.map((row) => [`${row.name}::${row.language_code}`, row]));
    const brand = await readTenantBrand(db);
    // The palette the tenant applied, then stock: an untouched clone made before branding is stock-colored.
    const palettes = [...(brand.palette?.appliedPalette ? [brand.palette.appliedPalette] : []), STOCK_EMAIL_PALETTE];

    for (const row of rows) {
      const systemRow = row.language_code ? systemByKey.get(`${row.name}::${row.language_code}`) : undefined;
      if (!systemRow) continue;
      summary.considered += 1;

      const match = matchDerivedRow(
        row, systemRow, PRIOR_SYSTEM_BODIES[row.name]?.[row.language_code!] ?? [], palettes, brand,
      );
      if (!match) {
        summary.unmatched += 1;
        continue;
      }

      // The hash covers the row exactly as it stands; the decoration is brand assets the resolver re-applies.
      const provenance: DerivedProvenance = {
        derived_from_system_id: match.systemRow.id,
        derived_palette: match.palette,
        derived_snapshot_hash: templateSnapshotHash(row),
      };
      summary.stamped.push({ name: row.name, language: row.language_code!, matchedBody: match.matchedBody });
      if (!options.dryRun) {
        await db.table('tenant_email_templates').where({ id: row.id }).update(provenance);
      }
    }

    if (!options.dryRun) {
      await writeMarker(db, trx, {
        ranAt: new Date().toISOString(),
        considered: summary.considered,
        stamped: summary.stamped.length,
        unmatched: summary.unmatched,
      });
    }
  });

  return summary;
}

export async function backfillDerivedTemplates(knex: Knex, options: BackfillOptions = {}): Promise<BackfillSummary> {
  const tenants: string[] = options.tenant
    ? [options.tenant]
    : (await knex('tenants').select('tenant')).map((row: { tenant: string }) => row.tenant);

  const result: BackfillSummary = { tenants: [], considered: 0, stamped: 0, unmatched: 0 };
  for (const tenant of tenants) {
    const summary = await backfillDerivedTemplatesForTenant(knex, tenant, options);
    result.tenants.push(summary);
    result.considered += summary.considered;
    result.stamped += summary.stamped.length;
    result.unmatched += summary.unmatched;

    if (summary.skipped) {
      options.onProgress?.(`tenant=${tenant} skipped (${summary.skipped})`);
      continue;
    }
    options.onProgress?.(
      `tenant=${tenant} considered=${summary.considered} stamped=${summary.stamped.length} unmatched=${summary.unmatched}${options.dryRun ? ' (dry run)' : ''}`,
    );
    for (const stamped of summary.stamped) {
      options.onProgress?.(`tenant=${tenant} stamped ${stamped.name} [${stamped.language}] matched=${stamped.matchedBody}`);
    }
  }
  return result;
}
