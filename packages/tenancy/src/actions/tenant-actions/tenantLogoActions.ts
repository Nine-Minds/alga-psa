'use server';

import {
  uploadEntityImage,
  deleteEntityImage,
  linkEntityImageFromDocument,
  recropEntityLogo,
  parseLogoCrop,
  type EntityLogoVariant,
  type EntityType,
  type LogoCropRect,
} from '@alga-psa/storage';
import { getConnection, tenantDb } from '@alga-psa/db';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import type { Knex } from 'knex';

const tenantSettingsQuery = (knex: Knex, tenant: string) =>
  tenantDb(knex, tenant).table('tenant_settings');

/** Branding key each logo variant writes to inside settings.branding. */
const BRANDING_LOGO_KEYS: Record<EntityLogoVariant, string> = {
  default: 'logoUrl',
  dark: 'logoDarkUrl',
  wide: 'logoWideUrl',
  'wide-dark': 'logoWideDarkUrl',
  favicon: 'faviconUrl',
};

const brandingLogoKey = (variant: EntityLogoVariant) =>
  BRANDING_LOGO_KEYS[variant] ?? BRANDING_LOGO_KEYS.default;

/** The wordmark slot a square mark is cut from: light from wide, dark from wide-dark. */
const markSourceVariant = (variant: EntityLogoVariant): EntityLogoVariant =>
  variant === 'dark' ? 'wide-dark' : 'wide';

/**
 * What a square mark was cut from. 'square' keeps the document of the original
 * square image, so adjusting the zone re-cuts that upload instead of cropping
 * the previous crop; 'wide' means the mark came out of the wide wordmark slot.
 */
export type TenantMarkSource = { kind: 'square'; documentId: string } | { kind: 'wide' };

/** Branding key recording each square mark's source. Only the mark slots have one. */
const MARK_SOURCE_KEYS: Partial<Record<EntityLogoVariant, string>> = {
  default: 'logoMarkSource',
  dark: 'logoDarkMarkSource',
};

/** Every crop is stored with this suffix, so a mark without it was uploaded square. */
const isMarkFileName = (fileName: string | null | undefined) => /\(mark\)(\.[^.]+)?$/.test(fileName ?? '');

/**
 * Writes one logo URL into settings.branding, creating the row if needed. Pass
 * `markSource` to record (or `null` to clear) where the slot's mark is cut from;
 * leave it out to keep whatever is stored.
 */
async function writeBrandingLogoUrl(
  tenant: string,
  logoVariant: EntityLogoVariant,
  url: string,
  markSource?: TenantMarkSource | null,
) {
  const knex = await getConnection(tenant);
  const existingRecord = await tenantSettingsQuery(knex, tenant).first();
  const existingSettings = existingRecord?.settings || {};
  const markSourceKey = MARK_SOURCE_KEYS[logoVariant];
  const updatedSettings = {
    ...existingSettings,
    branding: {
      ...(existingSettings.branding || {}),
      [brandingLogoKey(logoVariant)]: url,
      ...(markSourceKey && markSource !== undefined ? { [markSourceKey]: markSource } : {}),
      // Keep existing colors
      primaryColor: existingSettings.branding?.primaryColor,
      secondaryColor: existingSettings.branding?.secondaryColor,
      clientName: existingSettings.branding?.clientName,
    }
  };

  if (existingRecord) {
    await tenantSettingsQuery(knex, tenant)
      .update({ settings: updatedSettings, updated_at: knex.fn.now() });
  } else {
    await tenantSettingsQuery(knex, tenant).insert({
      tenant,
      settings: updatedSettings,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    });
  }
}

interface TenantLogoDocument {
  documentId: string;
  fileName: string | null;
  fileId: string | null;
}

/** The documents currently serving as this tenant's logos, keyed by variant. */
async function readLogoDocuments(knex: Knex, tenant: string): Promise<Map<string, TenantLogoDocument>> {
  const db = tenantDb(knex, tenant);
  const associations = await db.table('document_associations')
    .select('document_id', 'entity_logo_variant')
    .where({ entity_id: tenant, entity_type: 'tenant', is_entity_logo: true });

  const documentIds = associations
    .map((association: { document_id?: string }) => association.document_id)
    .filter((documentId: string | undefined): documentId is string => Boolean(documentId));

  const documents = documentIds.length
    ? await db.table('documents')
        .select('document_id', 'document_name', 'file_id')
        .whereIn('document_id', documentIds)
    : [];
  const byId = new Map<string, any>(documents.map((document: any) => [document.document_id, document]));

  const byVariant = new Map<string, TenantLogoDocument>();
  for (const association of associations) {
    const document = byId.get(association.document_id);
    if (!document) continue;
    byVariant.set(association.entity_logo_variant || 'default', {
      documentId: document.document_id,
      fileName: document.document_name ?? null,
      fileId: document.file_id ?? null,
    });
  }
  return byVariant;
}

async function readDocumentFileId(knex: Knex, tenant: string, documentId: string): Promise<string | null> {
  const document = await tenantDb(knex, tenant).table('documents')
    .select('file_id')
    .where({ document_id: documentId })
    .first();
  return document?.file_id ?? null;
}

const documentImageUrl = (fileId: string | null | undefined) =>
  fileId ? `/api/documents/view/${fileId}` : null;

/**
 * Where a square mark is cut from. A mark uploaded as its own square image is
 * re-cut from that upload; a mark cut out of a wordmark keeps cutting from the
 * wide slot. Marks stored before this was recorded are read off the file name.
 */
function resolveMarkSource(
  branding: Record<string, any>,
  logoVariant: EntityLogoVariant,
  mark: TenantLogoDocument | undefined,
): TenantMarkSource {
  const markSourceKey = MARK_SOURCE_KEYS[logoVariant];
  const recorded = markSourceKey ? (branding?.[markSourceKey] as TenantMarkSource | null | undefined) : undefined;
  if (recorded?.kind === 'square' && recorded.documentId) {
    return { kind: 'square', documentId: recorded.documentId };
  }
  if (recorded?.kind === 'wide') {
    return { kind: 'wide' };
  }
  if (mark && !isMarkFileName(mark.fileName)) {
    return { kind: 'square', documentId: mark.documentId };
  }
  return { kind: 'wide' };
}

/**
 * Upload a logo for the tenant
 */
export const uploadTenantLogo = withAuth(async (user: IUserWithRoles, { tenant }: AuthContext, tenantId: string, formData: FormData, logoVariant: EntityLogoVariant = 'default') => {
  try {
    // Check if user has admin permissions
    if (user.user_type !== 'internal') {
      return { success: false, error: 'Only internal users can update tenant logo' };
    }

    const file = formData.get('logo') as File;
    if (!file) {
      return { success: false, error: 'No file provided' };
    }

    // A wide image dropped into a square-mark slot arrives with the zone to
    // keep. Only the mark is stored: the wide slots stay whatever they were.
    let crop: LogoCropRect | null = null;
    if (logoVariant === 'default' || logoVariant === 'dark') {
      try {
        crop = parseLogoCrop(formData.get('crop'));
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Invalid logo crop' };
      }
    }

    // Upload the logo using EntityImageService
    const result = await uploadEntityImage(
      'tenant' as EntityType,
      tenantId,
      file,
      user.user_id,
      tenant,
      'tenant_logo',
      true, // isLogoUpload
      logoVariant,
      crop ? { crop } : {}
    );

    if (result.success) {
      // Record what "Adjust mark" cuts from: a square upload is its own source,
      // while a cropped upload came out of a wordmark, so the wide slot is.
      const markSource: TenantMarkSource | null | undefined = MARK_SOURCE_KEYS[logoVariant]
        ? (crop
            ? { kind: 'wide' }
            : (result.documentId ? { kind: 'square', documentId: result.documentId } : null))
        : undefined;
      await writeBrandingLogoUrl(tenant, logoVariant, result.imageUrl || '', markSource);

      return {
        success: true,
        message: 'Logo uploaded successfully',
        imageUrl: result.imageUrl
      };
    }

    return { success: false, error: 'Failed to upload logo' };
  } catch (error) {
    console.error('Error uploading tenant logo:', error);
    return { success: false, error: 'Failed to upload logo' };
  }
});

/**
 * Cut a new square mark from the image it was made of — the original square
 * upload when there was one, otherwise the matching wide logo — so the zone can
 * be adjusted without re-uploading.
 */
export const recropTenantLogo = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  tenantId: string,
  logoVariant: EntityLogoVariant,
  crop: LogoCropRect,
) => {
  try {
    if (user.user_type !== 'internal') {
      return { success: false, error: 'Only internal users can update tenant logo' };
    }
    if (logoVariant !== 'default' && logoVariant !== 'dark') {
      return { success: false, error: 'Only the square marks can be cropped' };
    }

    let validCrop: LogoCropRect | null;
    try {
      validCrop = parseLogoCrop(crop);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Invalid logo crop' };
    }
    if (!validCrop) {
      return { success: false, error: 'No crop provided' };
    }

    const knex = await getConnection(tenant);
    const settingsRecord = await tenantSettingsQuery(knex, tenant).first();
    const documents = await readLogoDocuments(knex, tenant);
    const markSource = resolveMarkSource(
      settingsRecord?.settings?.branding || {},
      logoVariant,
      documents.get(logoVariant),
    );

    const result = await recropEntityLogo('tenant' as EntityType, tenantId, user.user_id, tenant, {
      sourceVariant: markSourceVariant(logoVariant),
      // Square-sourced marks re-cut the original upload, so adjusting the zone
      // twice never stacks two crops.
      sourceDocumentId: markSource.kind === 'square' ? markSource.documentId : undefined,
      targetVariant: logoVariant,
      crop: validCrop,
      contextName: 'tenant_logo',
    });

    if (!result.success) {
      return { success: false, error: result.message || 'Failed to update logo' };
    }

    // Re-record the source: the crop now carries the "(mark)" name, so a row
    // that was only recognisable by its file name would otherwise read as
    // wide-sourced on the next adjust.
    await writeBrandingLogoUrl(tenant, logoVariant, result.imageUrl || '', markSource);

    return { success: true, message: 'Logo updated successfully', imageUrl: result.imageUrl };
  } catch (error) {
    console.error('Error recropping tenant logo:', error);
    return { success: false, error: 'Failed to update logo' };
  }
});

/**
 * Delete the tenant logo
 */
export const deleteTenantLogo = withAuth(async (user: IUserWithRoles, { tenant }: AuthContext, tenantId: string, logoVariant: EntityLogoVariant = 'default') => {
  try {
    // Check if user has admin permissions
    if (user.user_type !== 'internal') {
      return { success: false, error: 'Only internal users can delete tenant logo' };
    }

    // Delete the logo using EntityImageService
    const result = await deleteEntityImage(
      'tenant' as EntityType,
      tenantId,
      user.user_id,
      tenant,
      undefined,
      logoVariant
    );

    if (result.success) {
      // An empty slot has nothing to crop from, so the provenance goes with it.
      await writeBrandingLogoUrl(tenant, logoVariant, '', null);

      return {
        success: true,
        message: 'Logo deleted successfully'
      };
    }

    return { success: false, error: 'Failed to delete logo' };
  } catch (error) {
    console.error('Error deleting tenant logo:', error);
    return { success: false, error: 'Failed to delete logo' };
  }
});

export interface TenantLogoSlotInfo {
  /** Current image for the slot, or null when it is empty. */
  url: string | null;
  /** Name of the document behind the slot, so admins can tell the slots apart. */
  fileName: string | null;
  /** Image the crop dialog cuts from; null when the slot cannot be cropped. */
  cropSourceUrl: string | null;
}

export type TenantLogoInfo = Record<EntityLogoVariant, TenantLogoSlotInfo>;

/**
 * File name and crop source behind each logo slot. Branding only stores the
 * URLs, which say nothing about which file an admin uploaded or what a mark can
 * be re-cut from.
 */
export const getTenantLogoInfoAction = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
): Promise<TenantLogoInfo> => {
  const knex = await getConnection(tenant);
  const settingsRecord = await tenantSettingsQuery(knex, tenant).first();
  const branding = settingsRecord?.settings?.branding || {};
  const documents = await readLogoDocuments(knex, tenant);

  const slotFor = async (logoVariant: EntityLogoVariant): Promise<TenantLogoSlotInfo> => {
    const document = documents.get(logoVariant);
    const slot: TenantLogoSlotInfo = {
      url: documentImageUrl(document?.fileId),
      fileName: document?.fileName ?? null,
      cropSourceUrl: null,
    };

    if (!MARK_SOURCE_KEYS[logoVariant]) {
      return slot;
    }

    const markSource = resolveMarkSource(branding, logoVariant, document);
    if (markSource.kind === 'square') {
      const fileId = markSource.documentId === document?.documentId
        ? document?.fileId ?? null
        : await readDocumentFileId(knex, tenant, markSource.documentId);
      return { ...slot, cropSourceUrl: documentImageUrl(fileId) };
    }
    return { ...slot, cropSourceUrl: documentImageUrl(documents.get(markSourceVariant(logoVariant))?.fileId) };
  };

  const variants: EntityLogoVariant[] = ['default', 'dark', 'wide', 'wide-dark', 'favicon'];
  const slots = await Promise.all(variants.map((logoVariant) => slotFor(logoVariant)));

  return Object.fromEntries(variants.map((logoVariant, index) => [logoVariant, slots[index]])) as TenantLogoInfo;
});

/**
 * Fill a logo slot from a document the tenant already uploaded, so a logo that
 * is in the library does not have to be uploaded a second time.
 */
export const linkDocumentAsTenantLogo = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  tenantId: string,
  documentId: string,
  logoVariant: EntityLogoVariant = 'default',
) => {
  try {
    if (user.user_type !== 'internal') {
      return { success: false, error: 'Only internal users can update tenant logo' };
    }
    if (!documentId) {
      return { success: false, error: 'No document provided' };
    }

    const result = await linkEntityImageFromDocument('tenant' as EntityType, tenantId, user.user_id, tenant, {
      documentId,
      logoVariant,
      contextName: 'tenant_logo',
    });

    if (!result.success) {
      return { success: false, error: result.message || 'Failed to link document as logo' };
    }

    // A linked image fills the slot as it is, so a mark taken from the library
    // is its own crop source.
    const markSource: TenantMarkSource | null | undefined = MARK_SOURCE_KEYS[logoVariant]
      ? (result.documentId ? { kind: 'square', documentId: result.documentId } : null)
      : undefined;
    await writeBrandingLogoUrl(tenant, logoVariant, result.imageUrl || '', markSource);

    return { success: true, message: 'Logo linked successfully', imageUrl: result.imageUrl };
  } catch (error) {
    console.error('Error linking document as tenant logo:', error);
    return { success: false, error: 'Failed to link document as logo' };
  }
});
