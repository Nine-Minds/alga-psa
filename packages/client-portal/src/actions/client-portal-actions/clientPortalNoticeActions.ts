'use server';

import { hasPermission, withAuth } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { permissionError, type ActionPermissionErrorShape } from '@alga-psa/ui/lib/errorHandling';
import { isUuidShaped } from '@alga-psa/validation';
import type { Knex } from 'knex';
import {
  NOTICE_AUDIENCE_TYPES,
  normalizeNoticeInput,
  validateNoticeInput,
  type ClientPortalNoticeInput,
  type NoticeValidationError,
} from '../../lib/clientPortalNotices';
import {
  deleteNotice,
  findMissingTargetIds,
  getNoticeDetail,
  insertNotice,
  listNoticesWithAudience,
  previewAudienceClientNames,
  targetIdsForInput,
  updateNotice,
  type NoticeAudienceSelection,
  type NoticeDetail,
  type NoticeListItem,
} from '../../lib/clientPortalNoticesDb';

/** Structured, non-throwing outcomes. `code` is a stable key; the UI owns the text. */
export type NoticeActionFailure =
  | { success: false; code: 'validation'; errors: NoticeValidationError[] }
  | { success: false; code: 'invalid_targets'; missingTargetIds: string[] }
  | { success: false; code: 'not_found' }
  | { success: false; code: 'invalid_audience_type' };

/**
 * The refusal returned when guard() denies a call. `ActionPermissionError` is aliased to
 * `never` repo-wide, so it would vanish from a union; the structural shape stays visible.
 * Narrow with `isActionPermissionError` from '@alga-psa/ui/lib/errorHandling'.
 */
export type NoticeActionRefusal = ActionPermissionErrorShape;

export type ListClientPortalNoticesResult = NoticeListItem[] | NoticeActionRefusal;
export type GetClientPortalNoticeResult =
  | { success: true; notice: NoticeDetail }
  | Extract<NoticeActionFailure, { code: 'not_found' }>
  | NoticeActionRefusal;
export type CreateClientPortalNoticeResult =
  | { success: true; noticeId: string }
  | NoticeActionFailure
  | NoticeActionRefusal;
export type UpdateClientPortalNoticeResult = CreateClientPortalNoticeResult;
export type DeleteClientPortalNoticeResult =
  | { success: true }
  | Extract<NoticeActionFailure, { code: 'not_found' }>
  | NoticeActionRefusal;
export type PreviewClientPortalNoticeAudienceResult =
  | string[]
  | Extract<NoticeActionFailure, { code: 'invalid_audience_type' | 'invalid_targets' }>
  | NoticeActionRefusal;

const KEYS = {
  read: 'client-portal:errors.access.settingsRead',
  update: 'client-portal:errors.access.settingsUpdate',
  mspOnly: 'client-portal:errors.access.mspOnly',
} as const;

/**
 * MSP-only, then permission. Returns a permissionError to hand back, or null to proceed.
 * The user-type check runs first so client portal users never reach the permission check.
 */
async function guard(
  user: { user_type?: string },
  knex: Knex,
  action: 'read' | 'update',
): Promise<NoticeActionRefusal | null> {
  if (user.user_type === 'client') {
    return permissionError('Permission denied: client portal notices are managed by MSP users only', KEYS.mspOnly);
  }
  if (!(await hasPermission(user as any, 'settings', action, knex))) {
    return permissionError(`Permission denied: settings:${action} required`, action === 'read' ? KEYS.read : KEYS.update);
  }
  return null;
}

async function validateAndCheckTargets(
  knex: Knex | Knex.Transaction,
  tenant: string,
  rawInput: unknown,
): Promise<{ input: ClientPortalNoticeInput } | NoticeActionFailure> {
  const result = validateNoticeInput(rawInput);
  if (!result.valid) return { success: false, code: 'validation', errors: result.errors };
  const input = normalizeNoticeInput(rawInput as ClientPortalNoticeInput);
  if (input.audience_type !== 'all') {
    const ids = targetIdsForInput(input);
    // Malformed ids never reach Postgres (would throw invalid input syntax for uuid).
    const malformed = ids.filter((id) => !isUuidShaped(id));
    if (malformed.length > 0) return { success: false, code: 'invalid_targets', missingTargetIds: malformed };
    const missing = await findMissingTargetIds(
      knex, tenant, input.audience_type === 'clients' ? 'client' : 'tag', ids,
    );
    if (missing.length > 0) return { success: false, code: 'invalid_targets', missingTargetIds: missing };
  }
  return { input };
}

export const listClientPortalNotices = withAuth(async (user, { tenant }): Promise<ListClientPortalNoticesResult> => {
  const { knex } = await createTenantKnex();
  const denied = await guard(user, knex, 'read');
  if (denied) return denied;
  return listNoticesWithAudience(knex, tenant, new Date());
});

export const getClientPortalNotice = withAuth(async (user, { tenant }, noticeId: string): Promise<GetClientPortalNoticeResult> => {
  const { knex } = await createTenantKnex();
  const denied = await guard(user, knex, 'read');
  if (denied) return denied;
  if (!isUuidShaped(noticeId)) return { success: false as const, code: 'not_found' as const };
  const notice = await getNoticeDetail(knex, tenant, noticeId, new Date());
  if (!notice) return { success: false as const, code: 'not_found' as const };
  return { success: true as const, notice };
});

export const createClientPortalNotice = withAuth(async (user, { tenant }, rawInput: ClientPortalNoticeInput): Promise<CreateClientPortalNoticeResult> => {
  const { knex } = await createTenantKnex();
  const denied = await guard(user, knex, 'update');
  if (denied) return denied;

  return withTransaction(knex, async (trx) => {
    const checked = await validateAndCheckTargets(trx, tenant, rawInput);
    if (!('input' in checked)) return checked;
    const noticeId = await insertNotice(trx, tenant, user.user_id, checked.input);
    return { success: true as const, noticeId };
  });
});

/**
 * Open question 2 (PRD proposed answer): editing content (messages, link label/URL),
 * the audience type or the target set clears every dismissal so users see the changed
 * notice again. Schedule-, severity- and dismissible-only edits keep dismissals.
 */
export const updateClientPortalNotice = withAuth(async (user, { tenant }, noticeId: string, rawInput: ClientPortalNoticeInput): Promise<UpdateClientPortalNoticeResult> => {
  const { knex } = await createTenantKnex();
  const denied = await guard(user, knex, 'update');
  if (denied) return denied;
  if (!isUuidShaped(noticeId)) return { success: false as const, code: 'not_found' as const };

  return withTransaction(knex, async (trx) => {
    const checked = await validateAndCheckTargets(trx, tenant, rawInput);
    if (!('input' in checked)) return checked;
    const found = await updateNotice(trx, tenant, noticeId, checked.input);
    if (!found) return { success: false as const, code: 'not_found' as const };
    return { success: true as const, noticeId };
  });
});

export const deleteClientPortalNotice = withAuth(async (user, { tenant }, noticeId: string): Promise<DeleteClientPortalNoticeResult> => {
  const { knex } = await createTenantKnex();
  const denied = await guard(user, knex, 'update');
  if (denied) return denied;
  if (!isUuidShaped(noticeId)) return { success: false as const, code: 'not_found' as const };

  return withTransaction(knex, async (trx) => {
    const found = await deleteNotice(trx, tenant, noticeId);
    return found ? { success: true as const } : { success: false as const, code: 'not_found' as const };
  });
});

export const previewClientPortalNoticeAudience = withAuth(async (user, { tenant }, audience: NoticeAudienceSelection): Promise<PreviewClientPortalNoticeAudienceResult> => {
  const { knex } = await createTenantKnex();
  const denied = await guard(user, knex, 'read');
  if (denied) return denied;
  if (!audience || !(NOTICE_AUDIENCE_TYPES as readonly string[]).includes(audience.audienceType)) {
    return { success: false as const, code: 'invalid_audience_type' as const };
  }
  // Non-UUID target ids are REFUSED (not silently dropped), matching create/update.
  const targetIds = Array.isArray(audience.targetIds) ? audience.targetIds : [];
  const malformed = targetIds.filter((id) => !isUuidShaped(id));
  if (malformed.length > 0) return { success: false as const, code: 'invalid_targets' as const, missingTargetIds: malformed };
  return previewAudienceClientNames(knex, tenant, { audienceType: audience.audienceType, targetIds });
});
