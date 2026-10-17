/**
 * Mirrors readBotCredentialsFromEnv() in the EE bot connector; kept env-only so
 * the shared (CE-safe) callers never import the EE package statically.
 *
 * Lives outside the 'use server' actions module so both the Teams settings
 * status and the shell integration-health banner read the same condition — a
 * 'use server' file may only export async functions.
 */
export function isBotConnectorConfiguredFromEnv(): boolean {
  return Boolean(
    process.env.TEAMS_BOT_APP_ID?.trim()
    && process.env.TEAMS_BOT_APP_TENANT_ID?.trim()
    && process.env.TEAMS_BOT_APP_PASSWORD?.trim()
  );
}
