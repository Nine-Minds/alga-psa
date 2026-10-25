import type { RmmAlertOutboundAdapter } from '@alga-psa/shared/rmm/alerts';
import { createTenantKnex } from '@alga-psa/db';
import { buildDattoClientForTenant, getDattoIntegrationRow } from './buildClient';
import { DattoRmmPermissionError } from './dattoApiClient';
import type { DattoRmmIntegrationSettingsJson } from './shared';

function parseSettings(raw: unknown): DattoRmmIntegrationSettingsJson {
  if (typeof raw === 'string') {
    try {
      return (JSON.parse(raw) as DattoRmmIntegrationSettingsJson) ?? {};
    } catch {
      return {};
    }
  }
  return (raw as DattoRmmIntegrationSettingsJson) ?? {};
}

/**
 * Outbound surface for the shared alert pipeline: resolves the Datto alert
 * (POST /v2/alert/{uid}/resolve) when its linked Alga ticket is closed.
 *
 * Gated behind the integration's `resolveAlertsOnTicketClose` setting (off by
 * default) because it needs an API user with write rights. When off,
 * isResetEnabled answers false and the subscriber skips the alert entirely, so
 * it stays active locally, which is truthful because it is still open in Datto,
 * instead of being resolved locally only. This does not prevent a new ticket:
 * if the ticket closes while the alert is still open in Datto, the next poll
 * takes processRmmAlertEvent's linkedTicketGone path, reopens the alert and
 * raises a fresh ticket (as for any provider without an outbound adapter).
 * Resolve it in Datto, or turn the setting on, to avoid that.
 * Failures throw so the subscriber stamps `outbound_reset_error`.
 */
async function resolveOnCloseEnabled(tenantId: string): Promise<boolean> {
  const { knex } = await createTenantKnex();
  const integration = await getDattoIntegrationRow(knex, tenantId);
  if (!integration) return false;
  return parseSettings(integration.settings).resolveAlertsOnTicketClose === true;
}

export const dattoRmmAlertOutboundAdapter: RmmAlertOutboundAdapter = {
  async isResetEnabled({ tenantId }) {
    try {
      return await resolveOnCloseEnabled(tenantId);
    } catch {
      return false;
    }
  },

  async resetAlert({ tenantId, externalAlertId }) {
    if (!(await resolveOnCloseEnabled(tenantId))) return;

    const client = await buildDattoClientForTenant(tenantId);
    if (!client) {
      throw new Error('Datto RMM is not configured or credentials are missing; cannot resolve the alert.');
    }

    try {
      await client.resolveAlert(externalAlertId);
    } catch (error) {
      if (error instanceof DattoRmmPermissionError) {
        throw new Error(
          'Datto RMM refused to resolve the alert: the Datto API user needs write rights (resolve alerts).'
        );
      }
      throw error;
    }
  },
};
