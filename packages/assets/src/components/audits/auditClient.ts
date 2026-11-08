'use client';

import useSWR from 'swr';
import type {
  AssetAuditItemMethod,
  AssetAuditItemResult,
  AssetAuditListFilters,
  AssetAuditListPage,
  AssetAuditStatus,
  AssetAuditWithItems,
} from '@alga-psa/types';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getAssetAudit, listAssetAudits, previewAssetAuditScope } from '../../actions/assetAuditActions';

/**
 * Client plumbing shared by the audits list, the start dialog and the audit
 * detail page — the custody `custodyClient.ts` pattern.
 *
 * Audit server actions answer `{success, data} | {success:false, error:{message}}`
 * or a `{permissionError}` object; `auditOutcome` folds both into one shape so a
 * refusal shows the server's own wording and a denial can be told apart from a
 * failure.
 */

export type AuditOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; denied: boolean };

export function auditOutcome<T>(result: unknown): AuditOutcome<T> {
  if (isActionPermissionError(result)) return { ok: false, message: result.permissionError, denied: true };
  const r = result as { success?: boolean; data?: T; error?: { message?: string } } | null;
  if (r && r.success === true) return { ok: true, data: r.data as T };
  const message = r?.error?.message;
  return {
    ok: false,
    denied: false,
    message: message && !message.trimStart().startsWith('{') ? message : 'Something went wrong.',
  };
}

export const AUDIT_LIST_KEY = 'asset-audits';
export const AUDIT_CAPABILITY_KEY = ['asset-audits', 'capability'] as const;

/** Poll interval while a run is open, so marks made on the phone land here. */
export const AUDIT_IN_PROGRESS_REFRESH_MS = 20_000;

export function useAssetAuditList(filters: AssetAuditListFilters) {
  return useSWR<AssetAuditListPage, Error>(
    [AUDIT_LIST_KEY, 'list', filters],
    async () => {
      const outcome = auditOutcome<AssetAuditListPage>(await listAssetAudits(filters));
      if (!outcome.ok) throw new Error(outcome.message);
      return outcome.data;
    },
    { revalidateOnFocus: true, keepPreviousData: true },
  );
}

/**
 * One audit with its items. Revalidated on focus and polled while the run is
 * open: the acceptance criterion is that a scan made on a phone shows up on the
 * desktop without a reload, and the mobile session screen only reloads on mount
 * and resume, so the web side has to be the one that keeps looking.
 */
export function useAssetAuditDetail(auditId: string) {
  return useSWR<AssetAuditWithItems, Error>(
    auditId ? [AUDIT_LIST_KEY, 'detail', auditId] : null,
    async () => {
      const outcome = auditOutcome<AssetAuditWithItems>(await getAssetAudit(auditId));
      if (!outcome.ok) throw new Error(outcome.message);
      return outcome.data;
    },
    {
      revalidateOnFocus: true,
      refreshInterval: (latest) => (latest?.status === 'in_progress' ? AUDIT_IN_PROGRESS_REFRESH_MS : 0),
    },
  );
}

export interface AssetAuditCapability {
  /** May this user start, mark and close audits? Probed up front, not inferred from a failure. */
  canUpdate: boolean;
  isLoading: boolean;
}

/**
 * The asset:update verdict behind every "Start audit" affordance. The scope
 * preview action is the probe (it needs asset:update and answers with no client
 * given), so a denial folds into `canUpdate: false` exactly as custody's
 * location list does.
 */
export function useAssetAuditCapability(enabled = true): AssetAuditCapability {
  const { data, isLoading } = useSWR(enabled ? AUDIT_CAPABILITY_KEY : null, async () => {
    const outcome = auditOutcome<{ expected_count: number }>(await previewAssetAuditScope({}));
    // A denial hides the affordance; a transient failure must not — the user
    // would silently lose the ability to start an audit.
    return { canUpdate: outcome.ok ? true : !outcome.denied };
  });
  return { canUpdate: data?.canUpdate ?? false, isLoading };
}

/** Expected-count preview for the start dialog; null until a client is picked. */
export function useAssetAuditScopePreview(scope: {
  client_id?: string;
  location_id?: string | null;
  statuses?: string[];
} | null) {
  const { data, isLoading } = useSWR(
    scope?.client_id ? [AUDIT_LIST_KEY, 'scope', scope] : null,
    async () => {
      const outcome = auditOutcome<{ expected_count: number }>(await previewAssetAuditScope(scope!));
      return outcome.ok ? outcome.data.expected_count : null;
    },
    { keepPreviousData: false },
  );
  return { expectedCount: data ?? null, isLoading };
}

/** Calendar day of an instant, in the viewer's locale. Em dash when absent. */
export function formatAuditDate(iso: string | null | undefined, locale?: string): string {
  if (!iso) return '—';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '—' : at.toLocaleDateString(locale);
}

/** Day and time of an instant — what "marked at" needs during a walk. */
export function formatAuditDateTime(iso: string | null | undefined, locale?: string): string {
  if (!iso) return '—';
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? '—'
    : at.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

export type AuditTranslate = (key: string, options?: Record<string, unknown>) => string;

export function auditStatusLabel(t: AuditTranslate, status: AssetAuditStatus | string): string {
  return t(`enums.assetAuditStatus.${status}`, { defaultValue: status });
}

export function auditResultLabel(t: AuditTranslate, result: AssetAuditItemResult | string): string {
  return t(`enums.assetAuditResult.${result}`, { defaultValue: result });
}

export function auditMethodLabel(
  t: AuditTranslate,
  method: AssetAuditItemMethod | string | null | undefined,
): string {
  if (!method) return '—';
  return t(`enums.assetAuditMethod.${method}`, { defaultValue: method });
}

const STATUS_TONE: Record<string, 'info' | 'success' | 'neutral'> = {
  in_progress: 'info',
  completed: 'success',
  cancelled: 'neutral',
};

export function auditStatusTone(status: AssetAuditStatus | string): 'info' | 'success' | 'neutral' {
  return STATUS_TONE[status] ?? 'neutral';
}

const RESULT_TONE: Record<string, 'neutral' | 'success' | 'danger' | 'warning'> = {
  expected: 'neutral',
  present: 'success',
  missing: 'danger',
  unexpected: 'warning',
};

export function auditResultTone(result: AssetAuditItemResult | string): 'neutral' | 'success' | 'danger' | 'warning' {
  return RESULT_TONE[result] ?? 'neutral';
}
