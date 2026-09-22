/**
 * Send-time pass that turns the brand logo reference a branded template carries
 * into an inline attachment.
 *
 * A mail client has no origin to resolve a site-relative URL against, and Gmail,
 * Outlook and Apple Mail hold every remote image behind "download images". Only
 * an attachment referenced by Content-ID renders unprompted, so the bytes travel
 * inside the message.
 *
 * The pass is tolerant of rows written before the cid form: any marker tag is
 * normalized to `cid:` and embedded, whatever its `src` was, which repairs an
 * old row on its next send with no migration.
 */

import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { createTenantKnex, runWithTenant, tenantDb } from '@alga-psa/db';
// Subpaths, not the @alga-psa/storage barrel: the barrel re-exports
// StorageService, which pulls in @alga-psa/validation — a source-only package
// Node cannot resolve. The package index is imported by Node consumers such as
// the Temporal worker, so it must stay resolvable.
import { FileStoreModel } from '@alga-psa/storage/models/storage';
import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
import type { EmailAttachment } from '@alga-psa/types';
// Imported from the concrete modules rather than ./branding: that barrel also
// re-exports suggestEmailPalette, whose @alga-psa/tenancy/lib/* deep import is
// not in tenancy's exports map and would break every Node consumer of the
// package index (the Temporal worker among them).
import {
  brandLogoCid,
  parseBrandLogoVariant,
  readImgSrc,
  removeBrandLogo,
  withImgSrc,
  BRAND_LOGO_MARKER,
} from './branding/brandAssets';
import type { EmailBrandingLogoVariant } from './branding/types';

/** Graph caps a simple attachment at 3 MB, and the upload UI accepts far more. */
const MAX_LOGO_BYTES = 1024 * 1024;

/**
 * A notification fan-out sends dozens of mails per tenant per minute, so the
 * bytes are read once and reused. Time, not events: a logo five minutes stale
 * after a re-upload is nobody's problem.
 */
const LOGO_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * A miss costs two indexed reads, so it expires far sooner: a tenant who
 * uploads a logo and applies branding should see it on the next message, not
 * once the hit TTL runs out.
 */
const LOGO_MISS_CACHE_TTL_MS = 30 * 1000;

const MARKER_TAG = `<img\\b[^>]*${BRAND_LOGO_MARKER}[^>]*>`;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

interface BrandLogoAsset {
  content: Buffer;
  contentType: string;
  filename: string;
}

export interface EmbedBrandLogoOptions {
  tenantId: string;
  knex?: Knex;
  /** Logged beside the tenant when the pass cannot produce a logo. */
  context?: Record<string, unknown>;
}

export interface EmbedBrandLogoResult {
  html: string;
  attachments: EmailAttachment[];
}

/** Misses are cached too, so a tenant without a logo is not looked up per mail. */
const logoCache = new Map<string, { value: BrandLogoAsset | null; expiresAt: number }>();
const variantCache = new Map<string, { value: EmailBrandingLogoVariant; expiresAt: number }>();

export function clearBrandLogoCache(): void {
  logoCache.clear();
  variantCache.clear();
}

function tenantTable(knex: Knex, tenantId: string, table: string) {
  return tenantDb(knex, tenantId).table(table);
}

async function findLogoAssociation(
  knex: Knex,
  tenantId: string,
  variant: EmailBrandingLogoVariant,
): Promise<{ document_id: string } | null> {
  const forVariant = async (entityLogoVariant: string) =>
    await tenantTable(knex, tenantId, 'document_associations')
      .where({
        entity_id: tenantId,
        entity_type: 'tenant',
        is_entity_logo: true,
        entity_logo_variant: entityLogoVariant,
      })
      .first<{ document_id: string }>();

  // A tenant who asked for the wordmark but never uploaded one still gets a logo.
  const wide = variant === 'wide' ? await forVariant('wide') : null;
  return wide ?? (await forVariant('default')) ?? null;
}

async function readLogoAsset(
  knex: Knex,
  tenantId: string,
  variant: EmailBrandingLogoVariant,
): Promise<BrandLogoAsset | null> {
  const missing = (reason: string, details: Record<string, unknown> = {}) => {
    logger.warn(`[BrandLogo] ${reason}; sending without the logo`, { tenant: tenantId, variant, ...details });
    return null;
  };

  const association = await findLogoAssociation(knex, tenantId, variant);
  if (!association?.document_id) return missing('The tenant has no logo uploaded');

  const document = await tenantTable(knex, tenantId, 'documents')
    .select('file_id')
    .where({ document_id: association.document_id })
    .first<{ file_id?: string | null }>();
  if (!document?.file_id) return missing('The tenant logo document has no file');

  const file = await runWithTenant(tenantId, () => FileStoreModel.findById(knex, document.file_id!));
  if (!file?.storage_path) return missing('The tenant logo file is gone from storage');

  // Gmail, Outlook and Yahoo render no SVG in mail, inline or remote, so an SVG
  // upload is treated as no logo rather than mailed as a broken image.
  if ((file.mime_type ?? '').startsWith('image/svg')) {
    return missing('The tenant logo is an SVG, which mail clients do not render');
  }

  if (Number(file.file_size) > MAX_LOGO_BYTES) {
    return missing('The tenant logo is too large to embed', {
      bytes: Number(file.file_size),
      maxBytes: MAX_LOGO_BYTES,
    });
  }

  const provider = await StorageProviderFactory.createProvider();
  const content = await provider.download(file.storage_path);

  if (content.length > MAX_LOGO_BYTES) {
    return missing('The tenant logo is too large to embed', {
      bytes: content.length,
      maxBytes: MAX_LOGO_BYTES,
    });
  }

  const contentType = file.mime_type || 'image/png';
  const extension = EXTENSIONS[contentType] ?? 'png';

  return { content, contentType, filename: `logo.${extension}` };
}

/** Keeps a worker that serves many tenants from holding every logo forever. */
function cache<T>(
  store: Map<string, { value: T; expiresAt: number }>,
  key: string,
  value: T,
  ttlMs: number = LOGO_CACHE_TTL_MS,
): T {
  const now = Date.now();
  for (const [existing, entry] of store) {
    if (entry.expiresAt <= now) store.delete(existing);
  }
  store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

function cached<T>(store: Map<string, { value: T; expiresAt: number }>, key: string): { value: T } | null {
  const entry = store.get(key);
  return entry && entry.expiresAt > Date.now() ? entry : null;
}

async function loadLogoAsset(
  knex: Knex,
  tenantId: string,
  variant: EmailBrandingLogoVariant,
): Promise<BrandLogoAsset | null> {
  const key = `${tenantId}:${variant}`;
  const hit = cached(logoCache, key);
  if (hit) return hit.value;

  const asset = await readLogoAsset(knex, tenantId, variant);
  return cache(logoCache, key, asset, asset ? LOGO_CACHE_TTL_MS : LOGO_MISS_CACHE_TTL_MS);
}

/**
 * Which variant a row written before the cid form meant. Those rows are only
 * repaired in the database by a re-apply, so this read recurs on every send
 * until then and is cached like the bytes.
 */
async function loadSavedVariant(knex: Knex, tenantId: string): Promise<EmailBrandingLogoVariant> {
  const hit = cached(variantCache, tenantId);
  if (hit) return hit.value;

  const row = await tenantTable(knex, tenantId, 'tenant_settings')
    .select('settings')
    .first<{ settings?: Record<string, any> | null }>();

  return cache(variantCache, tenantId, row?.settings?.emailBranding?.logo?.variant === 'wide' ? 'wide' : 'default');
}

/**
 * Normalizes every brand-logo tag to its `cid:` form and returns the bytes to
 * attach alongside. A logo that cannot be read is dropped from the HTML rather
 * than left pointing at nothing, and a logo is never a reason to lose the mail:
 * whatever fails in here, the caller gets sendable HTML back.
 */
export async function embedBrandLogo(
  html: string,
  options: EmbedBrandLogoOptions,
): Promise<EmbedBrandLogoResult> {
  if (!html || !html.includes(BRAND_LOGO_MARKER)) return { html, attachments: [] };

  try {
    return await embedResolvedBrandLogo(html, options);
  } catch (error) {
    logger.error('[BrandLogo] Failed to embed the brand logo; sending without it', {
      tenant: options.tenantId,
      ...options.context,
      error: error instanceof Error ? error.message : String(error),
    });
    return { html: removeBrandLogo(html), attachments: [] };
  }
}

async function embedResolvedBrandLogo(
  html: string,
  options: EmbedBrandLogoOptions,
): Promise<EmbedBrandLogoResult> {
  const knex = options.knex ?? (await createTenantKnex(options.tenantId)).knex;
  const attachments = new Map<string, EmailAttachment>();
  const tags = new RegExp(MARKER_TAG, 'gi');
  let savedVariant: EmailBrandingLogoVariant | null = null;
  let result = '';
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tags.exec(html)) !== null) {
    const tag = match[0];
    const variant = parseBrandLogoVariant(readImgSrc(tag))
      ?? (savedVariant ??= await loadSavedVariant(knex, options.tenantId));
    const cid = brandLogoCid(variant);
    const asset = await loadLogoAsset(knex, options.tenantId, variant);

    result += html.slice(cursor, match.index);
    cursor = match.index + tag.length;

    // Nothing to embed: the reason was logged when the miss was cached, and a
    // fan-out must not repeat it per message.
    if (!asset) continue;

    result += withImgSrc(tag, `cid:${cid}`);
    if (!attachments.has(cid)) {
      attachments.set(cid, {
        filename: asset.filename,
        content: asset.content,
        contentType: asset.contentType,
        cid,
      });
    }
  }

  result += html.slice(cursor);

  return { html: result, attachments: [...attachments.values()] };
}
