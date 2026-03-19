/**
 * Public (unauthenticated) share-link helpers.
 *
 * These functions do NOT require a user session and use the admin DB connection.
 * They are intentionally NOT in a 'use server' file so they can be called from
 * Next.js API routes without triggering server-action authentication.
 */

import { getConnection } from '@alga-psa/db';
import bcrypt from 'bcryptjs';
import type { IShareLinkWithDocument, IValidateShareTokenResult } from '../actions/shareLinkActions';

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
 * Validates a share token without requiring authentication.
 * Uses admin connection, validates expiry/revocation/download limits.
 */
export async function validateShareToken(
  token: string
): Promise<IValidateShareTokenResult> {
  if (!token) {
    return { valid: false, error: 'Token is required' };
  }

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

  if (shareLink.is_revoked) {
    return { valid: false, error: 'Share link has been revoked' };
  }

  if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
    return { valid: false, error: 'Share link has expired' };
  }

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

  return bcrypt.compare(password, shareLink.password_hash);
}

/**
 * Logs an access attempt to a share link.
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
