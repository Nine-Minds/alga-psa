export type TelephonyAvailabilityDisabledReason =
  | 'ce_unavailable'
  | 'tenant_not_configured'
  | 'addon_required';

export type TelephonyAvailability =
  | {
      enabled: true;
      reason: 'enabled';
      message?: undefined;
    }
  | {
      enabled: false;
      reason: TelephonyAvailabilityDisabledReason;
      message: string;
    };

export interface ResolveTelephonyAvailabilityInput {
  isEnterpriseEdition?: boolean;
  requireTenantContext?: boolean;
  tenantId?: string | null;
}

export interface GetTelephonyAvailabilityInput extends ResolveTelephonyAvailabilityInput {
  userId?: string | null;
}

export const TELEPHONY_AVAILABILITY_MESSAGES: Record<TelephonyAvailabilityDisabledReason, string> = {
  ce_unavailable: 'Telephony integrations are only available in Enterprise Edition.',
  tenant_not_configured: 'Telephony integrations require tenant context.',
  addon_required: 'Telephony integrations require the Microsoft Teams add-on.',
};

type TelephonyEditionEnv = {
  EDITION?: string;
  NEXT_PUBLIC_EDITION?: string;
  [key: string]: string | undefined;
};

function getRuntimeEnv(): TelephonyEditionEnv {
  return typeof process === 'undefined' ? {} : process.env;
}

export function isTelephonyEnterpriseEdition(env: TelephonyEditionEnv = getRuntimeEnv()): boolean {
  const edition = (env.EDITION ?? '').toLowerCase();
  const publicEdition = (env.NEXT_PUBLIC_EDITION ?? '').toLowerCase();

  return edition === 'ee' || edition === 'enterprise' || publicEdition === 'enterprise';
}

export function disabledTelephonyAvailability(reason: TelephonyAvailabilityDisabledReason): TelephonyAvailability {
  return {
    enabled: false,
    reason,
    message: TELEPHONY_AVAILABILITY_MESSAGES[reason],
  };
}

export function resolveTelephonyAvailability(input: ResolveTelephonyAvailabilityInput = {}): TelephonyAvailability {
  const enterpriseEnabled = input.isEnterpriseEdition ?? isTelephonyEnterpriseEdition();
  if (!enterpriseEnabled) {
    return disabledTelephonyAvailability('ce_unavailable');
  }

  if (input.requireTenantContext !== false && !(input.tenantId || '').trim()) {
    return disabledTelephonyAvailability('tenant_not_configured');
  }

  return {
    enabled: true,
    reason: 'enabled',
  };
}
