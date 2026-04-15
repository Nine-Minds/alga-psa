import type { IComment } from '@alga-psa/types';

/** Aligns with Admin Settings (portal settings): `settings:read` / `settings:update` in RBAC. */
export function hasAdminSettingsViewAccess(permissions: readonly string[]): boolean {
  return permissions.includes('settings:read') || permissions.includes('settings:update');
}

export function isNonEmptyCommentMetadata(metadata: IComment['metadata'] | null | undefined): boolean {
  if (metadata == null || typeof metadata !== 'object') return false;
  return Object.keys(metadata as Record<string, unknown>).length > 0;
}

export type CommentMetadataSummaryRow = { label: string; value: string };

const PRIORITY_DEBUG_FIELDS: Array<{ label: string; path: string[] }> = [
  { label: 'responseSource', path: ['responseSource'] },
  { label: 'email.provider', path: ['email', 'provider'] },
  { label: 'email.messageId', path: ['email', 'messageId'] },
  { label: 'email.inReplyTo', path: ['email', 'inReplyTo'] },
  { label: 'email.references', path: ['email', 'references'] },
  { label: 'email.threadId', path: ['email', 'threadId'] },
  { label: 'email.fromAddress', path: ['email', 'fromAddress'] },
  { label: 'inboundReopenDecision.action', path: ['inboundReopenDecision', 'action'] },
  { label: 'inboundReopenDecision.cutoffExceeded', path: ['inboundReopenDecision', 'cutoffExceeded'] },
  { label: 'inboundReopenDecision.reopenTargetSource', path: ['inboundReopenDecision', 'reopenTargetSource'] },
  {
    label: 'inboundReopenDecision.aiSuppression.decision',
    path: ['inboundReopenDecision', 'aiSuppression', 'decision'],
  },
];

function getAtPath(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function formatSummaryValue(value: unknown): string | null {
  if (value === undefined) return null;
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Compact ordered summary for inbound-email debugging (only includes paths that exist on the payload).
 */
export function summarizeCommentMetadataForDebug(
  metadata: IComment['metadata'] | null | undefined
): CommentMetadataSummaryRow[] {
  if (!metadata || typeof metadata !== 'object') return [];

  const rows: CommentMetadataSummaryRow[] = [];
  for (const { label, path } of PRIORITY_DEBUG_FIELDS) {
    const raw = getAtPath(metadata, path);
    const formatted = formatSummaryValue(raw);
    if (formatted !== null) {
      rows.push({ label, value: formatted });
    }
  }
  return rows;
}

export function formatCommentMetadataJson(metadata: IComment['metadata'] | null | undefined): string {
  try {
    return JSON.stringify(metadata ?? {}, null, 2);
  } catch {
    return '{}';
  }
}
