import { isValidEmail } from '@alga-psa/core';
import { getActiveWatchListEmails } from '@shared/lib/tickets/watchList';

export function normalizeRecipientEmail(email: string): string {
  return email.trim().toLowerCase();
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
