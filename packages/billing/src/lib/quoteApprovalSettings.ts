import type { Knex } from 'knex';

export interface QuoteApprovalWorkflowSettings {
  approvalRequired: boolean;
}

const DEFAULT_SETTINGS: QuoteApprovalWorkflowSettings = {
  approvalRequired: false,
};

function normalizeSettings(rawSettings: unknown): Record<string, any> {
  if (!rawSettings) {
    return {};
  }

  if (typeof rawSettings === 'string') {
    try {
      return JSON.parse(rawSettings);
    } catch {
      return {};
    }
  }

  if (typeof rawSettings === 'object') {
    return rawSettings as Record<string, any>;
  }

  return {};
}

export async function getQuoteApprovalWorkflowSettings(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string
): Promise<QuoteApprovalWorkflowSettings> {
  const row = await knexOrTrx('tenant_settings')
    .select('settings')
    .where({ tenant })
    .first<{ settings?: unknown }>();

  const settings = normalizeSettings(row?.settings);
  return {
    approvalRequired: settings.billing?.quotes?.approvalRequired === true,
  };
}

export async function setQuoteApprovalWorkflowRequired(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  approvalRequired: boolean
): Promise<QuoteApprovalWorkflowSettings> {
  const row = await knexOrTrx('tenant_settings')
    .select('settings')
    .where({ tenant })
    .first<{ settings?: unknown }>();

  const currentSettings = normalizeSettings(row?.settings);
  const updatedSettings = {
    ...currentSettings,
    billing: {
      ...(currentSettings.billing ?? {}),
      quotes: {
        ...(currentSettings.billing?.quotes ?? {}),
        approvalRequired,
      },
    },
  };

  await knexOrTrx('tenant_settings')
    .insert({
      tenant,
      settings: JSON.stringify(updatedSettings),
      updated_at: knexOrTrx.fn.now(),
    })
    .onConflict('tenant')
    .merge({
      settings: JSON.stringify(updatedSettings),
      updated_at: knexOrTrx.fn.now(),
    });

  return { approvalRequired };
}
