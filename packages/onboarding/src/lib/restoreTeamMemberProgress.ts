import type { WizardData } from '@alga-psa/types';

/**
 * Rebuilds the "already created" marker for saved wizard progress.
 *
 * `addTeamMembers` persists `onboarding_data.teamMembers` holding only the
 * members it actually created (and nothing else writes that key), but it does
 * not persist `createdTeamMemberEmails`. Without this, a resumed wizard treats
 * every restored member as new and tries to invite or create them again.
 * Run it on saved progress at load time, never on live wizard state.
 */
export function restoreTeamMemberProgress(saved: Partial<WizardData>): Partial<WizardData> {
  const emails = [
    ...(saved.createdTeamMemberEmails ?? []),
    ...(saved.teamMembers ?? []).map((member) => member.email),
  ].filter((email): email is string => typeof email === 'string' && email.trim() !== '');

  return { ...saved, createdTeamMemberEmails: [...new Set(emails)] };
}
