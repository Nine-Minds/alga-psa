import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { FormFieldIssue } from './formValidation';

/**
 * The server's own validation failures, said in the signed-in user's language. The browser blocks
 * these first with the same wording; this is what a bypassed or stale form falls back to.
 * Shares the portal's `client-portal/service-requests` wording so the technician filing on behalf
 * of a contact reads the same sentence the contact would.
 */
// LEVERAGE: pattern service-request-issue-message — same rendering as describeSubmissionIssuesForRequester in client-portal/request-services/[definitionId]/actions.ts (a 'use server' file that cannot export it); the portal action could import this one.
export async function describeSubmissionIssues(issues: ReadonlyArray<FormFieldIssue>): Promise<string> {
  const { t } = await getServerTranslation(undefined, 'client-portal/service-requests');
  const sentences = issues.map((entry) => {
    if (entry.issue.rule === 'required') {
      return `"${entry.label}": ${t('detail.requiredField')}`;
    }
    if (entry.issue.customMessage) {
      return `"${entry.label}": ${entry.issue.customMessage}`;
    }
    return `"${entry.label}": ${t(`detail.validation.${entry.issue.rule}`, {
      ...(entry.issue.params ?? {}),
    })}`;
  });
  return `${t('detail.unableToSubmit')}: ${sentences.join('; ')}`;
}
