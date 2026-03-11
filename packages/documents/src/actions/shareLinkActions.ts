'use server';

import { randomBytes, randomUUID } from 'crypto';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, getConnection } from '@alga-psa/db';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import bcrypt from 'bcryptjs';

export type ShareType = 'public' | 'password' | 'portal_authenticated';

export interface IDocumentShareLink {
  share_id: string;
  tenant: string;
  document_id: string;
  token: string;
  share_type: ShareType;
  password_hash: string | null;
  expires_at: Date | null;
  max_downloads: number | null;
  download_count: number;
  is_revoked: boolean;
  revoked_at: Date | null;
  revoked_by: string | null;
  created_at: Date;
  created_by: string | null;
}

export interface IDocumentShareAccessLog {
  access_log_id: string;
  tenant: string;
  share_id: string;
  accessed_at: Date;
  ip_address: string | null;
  user_agent: string | null;
  user_id: string | null;
  access_type: 'view' | 'download' | 'info';
  was_successful: boolean;
  failure_reason: string | null;
}

export interface ICreateShareLinkInput {
  documentId: string;
  shareType?: ShareType;
  password?: string;
  expiresAt?: Date | null;
  maxDownloads?: number | null;
}

export interface IShareLinkWithDocument extends IDocumentShareLink {
  document_name?: string;
  file_id?: string;
}

export interface IValidateShareTokenResult {
  valid: boolean;
  share?: IShareLinkWithDocument;
  error?: string;
}

const SHARE_LINK_SELECT_COLUMNS = [
  'share_id',
  'tenant',
  'document_id',
  'token',
  'share_type',
  'password_hash',
  'expires_at',
  'max_downloads',
  'download_count',
  'is_revoked',
  'revoked_at',
  'revoked_by',
  'created_at',
  'created_by',
] as const;

/**
 * Generate a cryptographically secure 256-bit token encoded as URL-safe base64
 */
function generateToken(): string {
  const bytes = randomBytes(32); // 256 bits
  // URL-safe base64
  return bytes.toString('base64url');
}

/**
 * Hash a password using bcrypt
 */
async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10;
  return bcrypt.hash(password, saltRounds);
}

/**
 * Verify a password against a bcrypt hash
 */
async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Creates a new share link for a document.
 * F059: Generates 256-bit token, hashes password if provided, inserts record.
 */
export const createShareLink = withAuth(
  async (
    user,
    { tenant },
    input: ICreateShareLinkInput
  ): Promise<IDocumentShareLink | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    // Check document:share permission (or document:update as fallback)
    if (!(await hasPermission(user, 'document', 'update'))) {
      return permissionError('Permission denied');
    }

    if (!input.documentId) {
      throw new Error('documentId is required');
    }

    // Verify document exists in tenant
    const document = await knex('documents')
      .where({ document_id: input.documentId, tenant })
      .first();

    if (!document) {
      throw new Error('Document not found');
    }

    const shareType: ShareType = input.shareType || 'public';
    const token = generateToken();

    let passwordHash: string | null = null;
    if (shareType === 'password') {
      if (!input.password) {
        throw new Error('Password is required for password-protected shares');
      }
      passwordHash = await hashPassword(input.password);
    }

    const shareIdValue = randomUUID();

    await knex('document_share_links').insert({
      tenant,
      share_id: shareIdValue,
      document_id: input.documentId,
      token,
      share_type: shareType,
      password_hash: passwordHash,
      expires_at: input.expiresAt || null,
      max_downloads: input.maxDownloads || null,
      download_count: 0,
      is_revoked: false,
      created_by: user.user_id,
    });

    const shareLink = await knex('document_share_links')
      .select(SHARE_LINK_SELECT_COLUMNS)
      .where({ tenant, share_id: shareIdValue })
      .first();

    return shareLink as unknown as IDocumentShareLink;
  }
);

/**
 * Gets all active (non-revoked) share links for a document.
 * F060: Returns active share links for the document.
 */
export const getShareLinksForDocument = withAuth(
  async (
    user,
    { tenant },
    documentId: string
  ): Promise<IDocumentShareLink[] | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    if (!(await hasPermission(user, 'document', 'read'))) {
      return permissionError('Permission denied');
    }

    if (!documentId) {
      throw new Error('documentId is required');
    }

    const shareLinks = await knex('document_share_links')
      .select(SHARE_LINK_SELECT_COLUMNS)
      .where({
        tenant,
        document_id: documentId,
        is_revoked: false,
      })
      .orderBy('created_at', 'desc');

    return shareLinks as unknown as IDocumentShareLink[];
  }
);

/**
 * Revokes a share link (soft delete).
 * F061: Sets is_revoked = true and records revocation metadata.
 */
export const revokeShareLink = withAuth(
  async (
    user,
    { tenant },
    shareId: string
  ): Promise<boolean | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    if (!(await hasPermission(user, 'document', 'update'))) {
      return permissionError('Permission denied');
    }

    if (!shareId) {
      throw new Error('shareId is required');
    }

    const updated = await knex('document_share_links')
      .where({
        tenant,
        share_id: shareId,
        is_revoked: false,
      })
      .update({
        is_revoked: true,
        revoked_at: knex.fn.now(),
        revoked_by: user.user_id,
      });

    return updated > 0;
  }
);

/**
 * Validates a share token without requiring authentication.
 * F062: Uses admin connection, validates expiry/revocation/download limits.
 * Returns the share link with document info if valid, or an error message.
 */
export async function validateShareToken(
  token: string
): Promise<IValidateShareTokenResult> {
  if (!token) {
    return { valid: false, error: 'Token is required' };
  }

  // Use admin connection since this is called without authentication
  const knex = await getConnection();

  const shareLink = await knex('document_share_links as sl')
    .select([
      ...SHARE_LINK_SELECT_COLUMNS.map((col) => `sl.${col}`),
      'd.document_name',
      'd.file_id',
    ])
    .leftJoin('documents as d', function () {
      this.on('d.document_id', '=', 'sl.document_id').andOn('d.tenant', '=', 'sl.tenant');
    })
    .where('sl.token', token)
    .first();

  if (!shareLink) {
    return { valid: false, error: 'Invalid share link' };
  }

  // Check if revoked
  if (shareLink.is_revoked) {
    return { valid: false, error: 'Share link has been revoked' };
  }

  // Check expiry
  if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
    return { valid: false, error: 'Share link has expired' };
  }

  // Check download limit
  if (
    shareLink.max_downloads !== null &&
    shareLink.download_count >= shareLink.max_downloads
  ) {
    return { valid: false, error: 'Download limit exceeded' };
  }

  return {
    valid: true,
    share: shareLink as IShareLinkWithDocument,
  };
}

/**
 * Verifies a password for a password-protected share link.
 * Does not require authentication.
 */
export async function verifySharePassword(
  token: string,
  password: string,
  tenant: string
): Promise<boolean> {
  const knex = await getConnection();

  const shareLink = await knex('document_share_links')
    .select('password_hash')
    .where('token', token)
    .andWhere('tenant', tenant)
    .first();

  if (!shareLink || !shareLink.password_hash) {
    return false;
  }

  return verifyPassword(password, shareLink.password_hash);
}

/**
 * Logs an access attempt to a share link.
 * Does not require authentication.
 */
export async function logShareAccess(
  shareId: string,
  tenant: string,
  details: {
    ipAddress?: string;
    userAgent?: string;
    userId?: string;
    accessType: 'view' | 'download' | 'info';
    wasSuccessful: boolean;
    failureReason?: string;
  }
): Promise<void> {
  // Cannot log with invalid FK values — skip when share is unknown
  if (!shareId || !tenant || shareId === 'unknown' || tenant === 'unknown') {
    return;
  }

  const knex = await getConnection();

  await knex('document_share_access_log').insert({
    tenant,
    share_id: shareId,
    ip_address: details.ipAddress || null,
    user_agent: details.userAgent || null,
    user_id: details.userId || null,
    access_type: details.accessType,
    was_successful: details.wasSuccessful,
    failure_reason: details.failureReason || null,
  });
}

/**
 * Increments the download count for a share link.
 * Does not require authentication.
 */
export async function incrementDownloadCount(
  token: string,
  tenant: string
): Promise<void> {
  const knex = await getConnection();

  await knex('document_share_links')
    .where('token', token)
    .andWhere('tenant', tenant)
    .increment('download_count', 1);
}
