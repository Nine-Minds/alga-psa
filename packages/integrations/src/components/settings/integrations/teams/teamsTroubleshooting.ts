/**
 * Delivery error-code → remedy reference (F062).
 *
 * `TeamsDeliveryErrorCode` in the EE recorder
 * (ee/packages/microsoft-teams/src/lib/notifications/teamsDeliveryRecorder.ts)
 * is a type, not a runtime value, and lives behind the EE edition guard. To keep
 * this CE-safe module free of EE imports, the full code set is redeclared here as
 * a runtime list; T100 asserts it matches the EE union exactly and that every code
 * has a remedy entry.
 */

export const TEAMS_DELIVERY_ERROR_CODES = [
  'graph_unauthorized',
  'user_not_mapped',
  'feature_disabled',
  'integration_inactive',
  'package_misconfigured',
  'graph_not_found',
  'graph_throttled',
  'graph_server_error',
  'transient',
  'unknown',
] as const;

export type TeamsDeliveryErrorCode = (typeof TEAMS_DELIVERY_ERROR_CODES)[number];

export interface TeamsDeliveryErrorRemedy {
  causeKey: string;
  causeDefault: string;
  remedyKey: string;
  remedyDefault: string;
}

function entry(code: TeamsDeliveryErrorCode, causeDefault: string, remedyDefault: string): TeamsDeliveryErrorRemedy {
  return {
    causeKey: `integrations.teams.settings.troubleshooting.codes.${code}.cause`,
    causeDefault,
    remedyKey: `integrations.teams.settings.troubleshooting.codes.${code}.remedy`,
    remedyDefault,
  };
}

export const TEAMS_DELIVERY_ERROR_REMEDIES: Record<TeamsDeliveryErrorCode, TeamsDeliveryErrorRemedy> = {
  graph_unauthorized: entry(
    'graph_unauthorized',
    'Microsoft Graph rejected the application token (401/403); a required Graph application permission is not consented.',
    'Grant admin consent for the required Graph permissions (for example TeamsActivity.Send) in the Azure app registration.',
  ),
  user_not_mapped: entry(
    'user_not_mapped',
    'The recipient has not signed in to AlgaPSA with Microsoft, so no account mapping exists.',
    'Have the user sign in with Microsoft (MSP portal SSO or the Teams tab) so their account is mapped.',
  ),
  feature_disabled: entry(
    'feature_disabled',
    'The Teams release feature is disabled, so sends are skipped.',
    'Enable release-v1-5-feature for this tenant.',
  ),
  integration_inactive: entry(
    'integration_inactive',
    'The Teams integration is not active for this tenant.',
    'Activate the Teams integration in settings.',
  ),
  package_misconfigured: entry(
    'package_misconfigured',
    'The app package was never generated, or delivery prerequisites (app ID, base URL) are missing.',
    'Generate the Teams app package in settings, then retry.',
  ),
  graph_not_found: entry(
    'graph_not_found',
    'The Teams app is not installed for the recipient, so Microsoft Graph cannot target them (404).',
    'Install or org-allow the AlgaPSA app for that user.',
  ),
  graph_throttled: entry(
    'graph_throttled',
    'Microsoft Graph throttled the request (429).',
    'Transient; AlgaPSA retries with backoff. Investigate only if it persists.',
  ),
  graph_server_error: entry(
    'graph_server_error',
    'Microsoft Graph returned a server error (5xx).',
    'Transient Graph outage; AlgaPSA retries. Wait and check Microsoft service health if it persists.',
  ),
  transient: entry(
    'transient',
    'A temporary failure (network or timeout) interrupted delivery.',
    'Retried automatically; no action needed unless failures persist.',
  ),
  unknown: entry(
    'unknown',
    'The failure did not map to a known cause.',
    'Check the server logs for the delivery error detail and re-run diagnostics.',
  ),
};
