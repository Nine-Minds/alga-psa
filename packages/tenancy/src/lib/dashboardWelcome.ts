import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { resolveTenantDefaultCompanyName } from './tenantDefaultCompanyName';

/** Where the opt-in lives inside `tenant_settings.settings`. */
export const DASHBOARD_WELCOME_SETTINGS_KEY = 'dashboardWelcome';

export interface DashboardWelcomeSettings {
  /** Opt-in: name the MSP's own company in the dashboard banner. */
  useCompanyName: boolean;
  /** The client marked as "your company", or null when none is set. */
  companyName: string | null;
}

/** `settings` arrives as jsonb or, on some drivers, as the raw string. */
function parseSettings(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * Opt-in, so only an explicit `true` counts. Anything else — absent, null, the
 * string 'true' written by an older client — keeps the stock title.
 */
export function normalizeDashboardWelcomeFlag(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return (value as Record<string, unknown>).useCompanyName === true;
}

/**
 * The flag and the name it would show, resolved together: the banner only says
 * a company name when the tenant asked for one AND there is one to say.
 */
export async function resolveDashboardWelcome(
  conn: Knex | Knex.Transaction,
  tenant: string
): Promise<DashboardWelcomeSettings> {
  const [row, companyName] = await Promise.all([
    tenantDb(conn, tenant).table('tenant_settings').select('settings').first(),
    resolveTenantDefaultCompanyName(conn, tenant),
  ]);

  const settings = parseSettings(row?.settings);

  return {
    useCompanyName: normalizeDashboardWelcomeFlag(settings[DASHBOARD_WELCOME_SETTINGS_KEY]),
    companyName,
  };
}
