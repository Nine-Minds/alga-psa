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
import { FileStoreModel, StorageProviderFactory } from '@alga-psa/storage';
import type { EmailAttachment } from '@alga-psa/types';
import {
  brandLogoCid,
  parseBrandLogoVariant,
  BRAND_LOGO_MARKER,
  type EmailBrandingLogoVariant,
} from './branding';

/** Graph caps a simple attachment at 3 MB, and the upload UI accepts far more. */
const MAX_LOGO_BYTES = 1024 * 1024;

/**
 * A notification fan-out sends dozens of mails per tenant per minute, so the
 * bytes are read once and reused. Time, not events: a logo five minutes stale
 * after a re-upload is nobody's problem.
 */
const LOGO_CACHE_TTL_MS = 5 * 60 * 1000;

const MARKER_TAG = `<img\\b[^>]*${BRAND_LOGO_MARKER}[^>]*>`;
const SRC_ATTRIBUTE = /\ssrc="([^"]*)"/i;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

interface BrandLogoAsset {
  content: Buffer;
  contentType: string;
  filename: string;
}

export interface EmbedBrandLogoOptions {
  tenantId: string;
  knex?: Knex;
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
  const association = await findLogoAssociation(knex, tenantId, variant);
  if (!association?.document_id) return null;

  const document = await tenantTable(knex, tenantId, 'documents')
    .select('file_id')
    .where({ document_id: association.document_id })
    .first<{ file_id?: string | null }>();
  if (!document?.file_id) return null;

  const file = await runWithTenant(tenantId, () => FileStoreModel.findById(knex, document.file_id!));
  if (!file?.storage_path) return null;

  if (Number(file.file_size) > MAX_LOGO_BYTES) {
    logger.warn('[BrandLogo] Tenant logo is too large to embed; sending without it', {
      tenant: tenantId,
      variant,
      bytes: Number(file.file_size),
      maxBytes: MAX_LOGO_BYTES,
    });
    return null;
  }

  const provider = await StorageProviderFactory.createProvider();
  const content = await provider.download(file.storage_path);

  if (content.length > MAX_LOGO_BYTES) {
    logger.warn('[BrandLogo] Tenant logo is too large to embed; sending without it', {
      tenant: tenantId,
      variant,
      bytes: content.length,
      maxBytes: MAX_LOGO_BYTES,
    });
    return null;
  }

  const contentType = file.mime_type || 'image/png';
  const extension = EXTENSIONS[contentType] ?? 'png';

  return { content, contentType, filename: `logo.${extension}` };
}

/** Keeps a worker that serves many tenants from holding every logo forever. */
function cache<T>(store: Map<string, { value: T; expiresAt: number }>, key: string, value: T): T {
  const now = Date.now();
  for (const [existing, entry] of store) {
    if (entry.expiresAt <= now) store.delete(existing);
  }
  store.set(key, { value, expiresAt: now + LOGO_CACHE_TTL_MS });
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

  return cache(logoCache, key, await readLogoAsset(knex, tenantId, variant));
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

function withCidSrc(tag: string, cid: string): string {
  const src = ` src="cid:${cid}"`;
  return SRC_ATTRIBUTE.test(tag) ? tag.replace(SRC_ATTRIBUTE, () => src) : tag.replace(/^<img\b/i, `<img${src}`);
}

/**
 * Normalizes every brand-logo tag to its `cid:` form and returns the bytes to
 * attach alongside. A logo that cannot be read is dropped from the HTML rather
 * than left pointing at nothing.
 */
export async function embedBrandLogo(
  html: string,
  options: EmbedBrandLogoOptions,
): Promise<EmbedBrandLogoResult> {
  if (!html || !html.includes(BRAND_LOGO_MARKER)) return { html, attachments: [] };

  const knex = options.knex ?? (await createTenantKnex(options.tenantId)).knex;
  const attachments = new Map<string, EmailAttachment>();
  const tags = new RegExp(MARKER_TAG, 'gi');
  let savedVariant: EmailBrandingLogoVariant | null = null;
  let result = '';
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tags.exec(html)) !== null) {
    const tag = match[0];
    const variant = parseBrandLogoVariant(SRC_ATTRIBUTE.exec(tag)?.[1])
      ?? (savedVariant ??= await loadSavedVariant(knex, options.tenantId));
    const cid = brandLogoCid(variant);
    const asset = await loadLogoAsset(knex, options.tenantId, variant);

    result += html.slice(cursor, match.index);
    cursor = match.index + tag.length;

    if (!asset) {
      logger.warn('[BrandLogo] No tenant logo to embed; removing the placeholder', {
        tenant: options.tenantId,
        variant,
      });
      continue;
    }

    result += withCidSrc(tag, cid);
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
