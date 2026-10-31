import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export interface QuoteApprovalWorkflowSettings {
  approvalRequired: boolean;
}

const DEFAULT_SETTINGS: QuoteApprovalWorkflowSettings = {
  approvalRequired: false,
};

/**
 * Per-recipient "review and approve from the email link" setting, stored at
 * `tenant_settings.settings.billing.quotes.emailLinkReview`. Enabled by default.
 * `linkLifetimeHours: null` keeps the default lifetime (quote valid_until, else 30 days).
 */
export interface QuoteEmailLinkReviewSettings {
  enabled: boolean;
  linkLifetimeHours: number | null;
}

export const QUOTE_EMAIL_LINK_MIN_LIFETIME_HOURS = 24;
export const QUOTE_EMAIL_LINK_MAX_LIFETIME_HOURS = 90 * 24;

const DEFAULT_EMAIL_LINK_REVIEW: QuoteEmailLinkReviewSettings = {
  enabled: true,
  linkLifetimeHours: null,
};

/**
 * Validates a lifetime coming from a caller: null (use default) or a whole
 * number of hours within the floor and cap. Throws on anything else.
 */
export function validateQuoteEmailLinkLifetimeHours(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < QUOTE_EMAIL_LINK_MIN_LIFETIME_HOURS ||
    value > QUOTE_EMAIL_LINK_MAX_LIFETIME_HOURS
  ) {
    throw new Error(
      `Link lifetime must be a whole number of hours between ${QUOTE_EMAIL_LINK_MIN_LIFETIME_HOURS} and ${QUOTE_EMAIL_LINK_MAX_LIFETIME_HOURS}`
    );
  }
  return value;
}

function readEmailLinkReview(settings: Record<string, any>): QuoteEmailLinkReviewSettings {
  const raw = settings.billing?.quotes?.emailLinkReview;
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_EMAIL_LINK_REVIEW };
  }
  const hours = raw.linkLifetimeHours;
  return {
    enabled: raw.enabled !== false,
    linkLifetimeHours: typeof hours === 'number' && Number.isFinite(hours) && hours > 0 ? hours : null,
  };
}

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
  const row = await tenantDb(knexOrTrx, tenant).table('tenant_settings')
    .select('settings')
    .first<{ settings?: unknown }>();

  const settings = normalizeSettings(row?.settings);
  return {
    approvalRequired: settings.billing?.quotes?.approvalRequired === true,
  };
}

export async function getQuoteEmailLinkReviewSettings(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string
): Promise<QuoteEmailLinkReviewSettings> {
  const row = await tenantDb(knexOrTrx, tenant).table('tenant_settings')
    .select('settings')
    .first<{ settings?: unknown }>();

  return readEmailLinkReview(normalizeSettings(row?.settings));
}

export async function setQuoteEmailLinkReviewSettings(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  input: QuoteEmailLinkReviewSettings
): Promise<QuoteEmailLinkReviewSettings> {
  const next: QuoteEmailLinkReviewSettings = {
    enabled: input.enabled === true,
    linkLifetimeHours: validateQuoteEmailLinkLifetimeHours(input.linkLifetimeHours),
  };

  const row = await tenantDb(knexOrTrx, tenant).table('tenant_settings')
    .select('settings')
    .first<{ settings?: unknown }>();

  const currentSettings = normalizeSettings(row?.settings);
  const updatedSettings = {
    ...currentSettings,
    billing: {
      ...(currentSettings.billing ?? {}),
      quotes: {
        ...(currentSettings.billing?.quotes ?? {}),
        emailLinkReview: next,
      },
    },
  };

  await tenantDb(knexOrTrx, tenant).table('tenant_settings')
    .insert({
      tenant,
      settings: JSON.stringify(updatedSettings),
      updated_at: knexOrTrx.fn.now(),
    })
    .onConflict('tenant')
    .merge({
      settings: JSON.stringify(updatedSettings),
      updated_at: new Date().toISOString(),
    });

  return next;
}

export async function setQuoteApprovalWorkflowRequired(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  approvalRequired: boolean
): Promise<QuoteApprovalWorkflowSettings> {
  const row = await tenantDb(knexOrTrx, tenant).table('tenant_settings')
    .select('settings')
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

  await tenantDb(knexOrTrx, tenant).table('tenant_settings')
    .insert({
      tenant,
      settings: JSON.stringify(updatedSettings),
      updated_at: knexOrTrx.fn.now(),
    })
    .onConflict('tenant')
    .merge({
      settings: JSON.stringify(updatedSettings),
      updated_at: new Date().toISOString(),
    });

  return { approvalRequired };
}
