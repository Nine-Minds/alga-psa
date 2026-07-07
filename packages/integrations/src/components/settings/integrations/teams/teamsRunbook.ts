/**
 * In-app runbook links (F058).
 *
 * Anchors mirror the section headings in docs/integrations/teams-setup.md.
 * Keep them in sync with that runbook; T095 asserts they match the headings.
 */

export const TEAMS_SETUP_RUNBOOK_URL = 'https://docs.algapsa.com/integrations/teams-setup';

export type TeamsRunbookSection =
  | 'entraApp'
  | 'graphPermissions'
  | 'botRegistration'
  | 'activate'
  | 'package'
  | 'webhook'
  | 'verify';

export const TEAMS_RUNBOOK_ANCHORS: Record<TeamsRunbookSection, string> = {
  entraApp: '#1-create-the-entra-app-registration',
  graphPermissions: '#2-grant-graph-application-permissions',
  botRegistration: '#3-register-the-azure-bot-and-set-bot-credentials',
  activate: '#4-configure-and-activate-teams-in-alga-psa',
  package: '#5-generate-and-upload-the-teams-app-package',
  webhook: '#6-configure-the-recordings-webhook',
  verify: '#7-verify',
};

export function teamsRunbookHref(section: TeamsRunbookSection): string {
  return `${TEAMS_SETUP_RUNBOOK_URL}${TEAMS_RUNBOOK_ANCHORS[section]}`;
}
