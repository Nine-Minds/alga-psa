/**
 * Single deny-by-default gate for every Teams emulator override
 * (`TEAMS_BOT_OPENID_CONFIG_URL`, `TEAMS_BOT_SERVICE_URL_ALLOWLIST`, and — for
 * the Teams surface only — `MICROSOFT_LOGIN_BASE_URL` /
 * `MICROSOFT_GRAPH_BASE_URL`). Those decide where the bot secret is POSTed and
 * whose JWTs are accepted, so they must never turn themselves on: a host with
 * NODE_ENV unset, or set to "staging", is not a licence to redirect them.
 *
 * The overrides are honored only when TEAMS_EMULATOR_MODE is explicitly one of
 * the recognized on-values. Anything else — unset, empty, "staging", "yes",
 * a typo — fails closed, and production is a hard second lock the flag cannot
 * unlock.
 */
const ENABLED_VALUES = new Set(['true', '1']);

export function isTeamsEmulatorModeEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  const raw = process.env.TEAMS_EMULATOR_MODE?.trim().toLowerCase();
  return raw !== undefined && ENABLED_VALUES.has(raw);
}
