'use client';

import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { RmmAgentStatus } from '@alga-psa/types';
import {
  RMM_AGENT_STATUS_LABEL_DEFAULTS,
  RMM_AGENT_STATUS_VALUES,
} from '../lib/rmmAgentStatusOptions';

const ASSETS_NAMESPACE = 'msp/assets';

export interface RmmAgentStatusOption {
  value: RmmAgentStatus;
  label: string;
}

export function useRmmAgentStatusOptions(): RmmAgentStatusOption[] {
  const { t } = useTranslation(ASSETS_NAMESPACE);
  return RMM_AGENT_STATUS_VALUES.map((value) => ({
    value,
    label: t(`enums.rmmAgentStatus.${value}`, {
      defaultValue: RMM_AGENT_STATUS_LABEL_DEFAULTS[value],
    }),
  }));
}

export function useFormatRmmAgentStatus(): (value: string) => string {
  const { t } = useTranslation(ASSETS_NAMESPACE);
  return (value: string) => {
    const fallback =
      RMM_AGENT_STATUS_LABEL_DEFAULTS[value as RmmAgentStatus] ?? value;
    return t(`enums.rmmAgentStatus.${value}`, { defaultValue: fallback });
  };
}
