import { createHash } from 'node:crypto';
import { isEnterprise } from '@alga-psa/core/features';
import type { TenantDb } from '@alga-psa/db';
// Specific modules, not the branding barrel: this loads in operator scripts and the send path,
// which have no use for the barrel's settings-panel helpers (and their transitive imports).
import type { BrandDecorationOptions } from './branding/brandAssets';
import { decoratorFor, resolveBrandDecoration, type ResolvedBrandDecoration } from './branding/brandDecorator';
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
  /**
   * The exact brand decoration (logo variant + alt, attribution) the row was
   * written with. Part of the derivation's provenance: the resolver replays
   * this, never the tenant's current settings. Null on a row stamped before it
   * was recorded; such a row is not served as derived.
   */
  derived_decoration: StoredBrandDecoration | null;
  derived_snapshot_hash: string | null;
}

/** An undecorated derivation (Community, or a stock clone with no brand): explicit, so it is distinguishable from "not recorded". */
export const NO_BRAND_DECORATION: StoredBrandDecoration = { hideAttribution: false };

export type StoredBrandDecoration = ResolvedBrandDecoration;

export interface SnapshotContent {
  subject: string | null | undefined;
  html_content: string | null | undefined;
  text_content?: string | null | undefined;
}

/** What a tenant row carries once it is the tenant's own again. */
export const NO_DERIVED_PROVENANCE: DerivedProvenance = {
  derived_from_system_id: null,
  derived_palette: null,
  derived_decoration: null,
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
  decoration?: BrandDecorationOptions,
): R & DerivedProvenance {
  // Verified through the very function the resolver serves with, over the options that get recorded.
  const recorded = normalizeDecoration(decoration);
  const derived = deriveTemplate(systemRow, palette, decoratorFor(recorded));
  const isDerivation = derived.subject === row.subject
    && derived.html_content === row.html_content
    && derived.text_content === row.text_content;
  if (!isDerivation) return { ...row, ...NO_DERIVED_PROVENANCE };

  return {
    ...row,
    derived_from_system_id: systemRow.id,
    derived_palette: palette,
    derived_decoration: recorded,
    derived_snapshot_hash: templateSnapshotHash(row),
  };
}

/** Options as stored: every field decided, no undefined keys (jsonb round-trips exactly). */
export function normalizeDecoration(decoration: BrandDecorationOptions | null | undefined): StoredBrandDecoration {
  if (!decoration) return NO_BRAND_DECORATION;
  return {
    ...(decoration.logo ? { logo: { variant: decoration.logo.variant, alt: decoration.logo.alt ?? '' } } : {}),
    hideAttribution: decoration.hideAttribution === true,
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
 * `target`, for a WRITER to apply and record. Never for serving: a served
 * derived row replays its stored `derived_decoration`. Undefined on Community.
 */
export function tenantBrandDecoration(brand: TenantBrand, target: EmailPaletteTokens): ResolvedBrandDecoration | undefined {
  return resolveBrandDecoration(brand.palette ?? {}, brand.branding, isEnterprise, target);
}

/**
 * What an untouched derived row reads as today: the current system template in the
 * row's own stored palette, decorated with the row's own stored decoration. Nothing
 * here reads the tenant's current settings. The single derivation shared by the
 * resolver (sends), the settings list and its preview.
 */
export function derivedContentFor(
  row: { derived_palette?: EmailPaletteTokens | null; derived_decoration?: BrandDecorationOptions | null },
  systemRow: { subject: string; html_content: string; text_content: string },
) {
  return deriveTemplate(systemRow, row.derived_palette!, decoratorFor(row.derived_decoration));
}

/** A row still serves as a derivation only if nobody changed it since it was stamped. */
export function isUntouchedDerivation(row: SnapshotContent & Partial<DerivedProvenance>): boolean {
  return row.derived_from_system_id != null
    && !!row.derived_palette
    && !!row.derived_decoration
    && !!row.derived_snapshot_hash
    && templateSnapshotHash(row) === row.derived_snapshot_hash;
}
