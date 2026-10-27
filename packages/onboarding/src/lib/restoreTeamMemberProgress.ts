import type { WizardData } from '@alga-psa/types';
import { uniqueTeamMemberEmails } from './teamMemberEmails';

/**
 * Rebuilds the "already created" marker for saved wizard progress.
 *
 * The team actions record every member they create, across save rounds, in
 * `onboarding_data.teamMembers` and `createdTeamMemberEmails` (nothing else
 * writes those keys). Progress saved before `createdTeamMemberEmails` was
 * recorded has only `teamMembers`, so both are folded together here. Without
 * this, a resumed wizard treats every restored member as new and tries to
 * invite or create them again.
 * Run it on saved progress at load time, never on live wizard state.
 */
export function restoreTeamMemberProgress(saved: Partial<WizardData>): Partial<WizardData> {
  const emails = uniqueTeamMemberEmails([
    ...(saved.createdTeamMemberEmails ?? []),
    ...(saved.teamMembers ?? []).map((member) => member.email),
  ]);

  return { ...saved, createdTeamMemberEmails: emails };
}
