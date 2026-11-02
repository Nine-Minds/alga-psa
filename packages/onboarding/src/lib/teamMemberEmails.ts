/**
 * The one rule for a team member's email in onboarding: trimmed and
 * lower-cased. Saved progress, the wizard's guard and the team step compare
 * through it, so `Dana@x.com` and `dana@x.com` are one member everywhere.
 *
 * addUser itself only lower-cases (it does not trim), so the onboarding team
 * actions apply this rule before calling it: an account they create is stored
 * under exactly this key, and the address recorded in progress names it.
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
