/**
 * The one rule for matching a team member's email in onboarding: trimmed and
 * lower-cased, the same as internal sign-in identities are stored. Saved
 * progress, the wizard's guard and the team step all compare through it, so
 * `Dana@x.com` and `dana@x.com` are one member everywhere.
 */
export function teamMemberEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

/** True when `email` is in `emails` under teamMemberEmailKey. */
export function hasTeamMemberEmail(emails: readonly string[] | undefined, email: string): boolean {
  const key = teamMemberEmailKey(email);
  return (emails ?? []).some((candidate) => teamMemberEmailKey(candidate) === key);
}

/** Normalized, de-duplicated list (first occurrence order kept). */
export function uniqueTeamMemberEmails(emails: readonly string[]): string[] {
  return [...new Set(emails.filter((email) => typeof email === 'string' && email.trim() !== '').map(teamMemberEmailKey))];
}
