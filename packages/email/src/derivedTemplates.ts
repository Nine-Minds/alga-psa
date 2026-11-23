import { createHash } from 'node:crypto';
import { isEnterprise } from '@alga-psa/core/features';
import type { TenantDb } from '@alga-psa/db';
// Specific modules, not the branding barrel: this loads in operator scripts and the send path,
// which have no use for the barrel's settings-panel helpers (and their transitive imports).
import { brandDecorator } from './branding/brandDecorator';
import { deriveTemplate } from './branding/deriveTemplate';
import { readEmailBrandingPalette } from './branding/readEmailBrandingPalette';
import type { EmailBrandingPalette, EmailPaletteTokens } from './branding/types';

/**
 * Provenance of a tenant email template the branding tool wrote: it is a
 * derived view of a system template (see lookupEmailTemplate) for as long as
 * the stored content still hashes to what was written. Any later edit breaks
 * the hash and the row is the tenant's own.
 */
export interface DerivedProvenance {
  derived_from_system_id: number | null;
  derived_palette: EmailPaletteTokens | null;
  derived_snapshot_hash: string | null;
}

export interface SnapshotContent {
  subject: string | null | undefined;
  html_content: string | null | undefined;
  text_content?: string | null | undefined;
}

/** What a tenant row carries once it is the tenant's own again. */
export const NO_DERIVED_PROVENANCE: DerivedProvenance = {
  derived_from_system_id: null,
  derived_palette: null,
  derived_snapshot_hash: null,
};

/** sha256 of `subject\0html\0text`, the content as written. */
export function templateSnapshotHash(content: SnapshotContent): string {
  return createHash('sha256')
    .update(`${content.subject ?? ''}\0${content.html_content ?? ''}\0${content.text_content ?? ''}`)
    .digest('hex');
}

/**
 * The one place provenance is written. Takes the content about to be stored and
 * returns it with the columns that tie it to the system template and palette it
 * was derived from — but only when the content really is that derivation
 * (system template, palette substituted, `decorate` applied). Anything else is
 * the tenant's own text and comes back with no provenance, so a caller never
 * has to decide that itself and a row can never claim a derivation it isn't.
 */
export function stampDerivedTemplate<R extends SnapshotContent & { subject: string; html_content: string; text_content: string }>(
  row: R,
  systemRow: { id: number; subject: string; html_content: string; text_content: string },
  palette: EmailPaletteTokens,
  decorate?: (html: string) => string,
): R & DerivedProvenance {
  const derived = deriveTemplate(systemRow, palette, decorate);
  const isDerivation = derived.subject === row.subject
    && derived.html_content === row.html_content
    && derived.text_content === row.text_content;
  if (!isDerivation) return { ...row, ...NO_DERIVED_PROVENANCE };

  return {
    ...row,
    derived_from_system_id: systemRow.id,
    derived_palette: palette,
    derived_snapshot_hash: templateSnapshotHash(row),
  };
}

/** What the tenant has saved about their brand: the email palette and the logo/name settings. */
export interface TenantBrand {
  palette: EmailBrandingPalette | null;
  branding: Record<string, any> | null;
}

export async function readTenantBrand(db: TenantDb): Promise<TenantBrand> {
  const settingsRow = await db.table('tenant_settings').select('settings').first();
  const settings = (settingsRow?.settings && typeof settingsRow.settings === 'object' ? settingsRow.settings : {}) as Record<string, any>;
  return { palette: readEmailBrandingPalette(settings.emailBranding), branding: settings.branding ?? null };
}

/**
 * The decoration the tenant's saved brand asks of a template painted with
 * `target`: the same decorator the apply flow builds, from the tenant's own
 * settings. Undefined on Community or when nothing is configured.
 */
export function tenantBrandDecorator(brand: TenantBrand, target: EmailPaletteTokens): ((html: string) => string) | undefined {
  return brandDecorator(brand.palette ?? {}, brand.branding, isEnterprise, target);
}

/**
 * What an untouched derived row reads as today: the current system template in the
 * row's own stored palette, decorated with the tenant's brand. The single
 * derivation shared by the resolver (sends), the settings list and its preview.
 */
export function derivedContentFor(
  row: { derived_palette?: EmailPaletteTokens | null },
  systemRow: { subject: string; html_content: string; text_content: string },
  brand: TenantBrand,
) {
  const palette = row.derived_palette!;
  return deriveTemplate(systemRow, palette, tenantBrandDecorator(brand, palette));
}

/** A row still serves as a derivation only if nobody changed it since it was stamped. */
export function isUntouchedDerivation(row: SnapshotContent & Partial<DerivedProvenance>): boolean {
  return row.derived_from_system_id != null
    && !!row.derived_palette
    && !!row.derived_snapshot_hash
    && templateSnapshotHash(row) === row.derived_snapshot_hash;
}
