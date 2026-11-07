import { isValidEmail } from '@alga-psa/core';
import { tenantDb } from '@alga-psa/db';
import { getActiveWatchListEmails } from '@shared/lib/tickets/watchList';
import type { Knex } from 'knex';

export function normalizeRecipientEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Given a list of watcher emails, return the subset that belong to internal
 * (MSP) users for this tenant, normalized for comparison. Callers use this to
 * decide whether a watcher should receive the MSP (/msp/...) link or the
 * client-portal link: watchers can be either internal agents or external
 * client contacts, and the watch list itself stores only bare email strings
 * with no type distinction.
 */
export async function resolveInternalWatcherEmails(
  db: Knex,
  tenantId: string,
  emails: string[]
): Promise<Set<string>> {
  return new Set((await resolveInternalWatcherUserIds(db, tenantId, emails)).keys());
}

export async function resolveInternalWatcherUserIds(
  db: Knex,
  tenantId: string,
  emails: string[]
): Promise<Map<string, string>> {
  const normalized = Array.from(
    new Set(emails.map((email) => normalizeRecipientEmail(email)).filter((email) => isValidEmail(email)))
  );
  if (normalized.length === 0) {
    return new Map<string, string>();
  }

  const rows = await tenantDb(db, tenantId).table('users')
    .select('email', 'user_id')
    .where({ user_type: 'internal' })
    .whereIn(db.raw('lower(email)') as unknown as string, normalized);

  return new Map(rows.map((row: { email: string; user_id: string }) => [
    normalizeRecipientEmail(row.email),
    row.user_id,
  ]));
}

export function extractActiveWatcherEmails(attributes: unknown): string[] {
  return Array.from(new Set(getActiveWatchListEmails(attributes).map((email) => normalizeRecipientEmail(email))));
}

export async function sendOneEmailPerWatcher(
  watcherEmails: string[],
  sendFn: (email: string) => Promise<void>,
  options?: {
    excludeEmails?: Set<string>;
  }
): Promise<void> {
  const seen = new Set<string>();
  const excluded = options?.excludeEmails ?? new Set<string>();

  for (const watcherEmail of watcherEmails) {
    const email = watcherEmail?.trim();
    if (!isValidEmail(email)) {
      continue;
    }

    const normalized = normalizeRecipientEmail(email);
    if (seen.has(normalized) || excluded.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    await sendFn(email);
  }
}
