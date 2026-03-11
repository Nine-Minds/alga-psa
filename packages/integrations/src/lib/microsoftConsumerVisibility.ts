import { isEnterprise } from '@alga-psa/core';
import type { MicrosoftProfileConsumer } from '../actions/integrations/microsoftShared';

const CE_VISIBLE_MICROSOFT_CONSUMERS: MicrosoftProfileConsumer[] = ['msp_sso'];
const EE_VISIBLE_MICROSOFT_CONSUMERS: MicrosoftProfileConsumer[] = ['msp_sso', 'email', 'calendar', 'teams'];

export function isMicrosoftConsumerEnterpriseEdition(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env === process.env) {
    return isEnterprise;
  }

  const edition = (env.EDITION ?? '').toLowerCase();
  const publicEdition = (env.NEXT_PUBLIC_EDITION ?? '').toLowerCase();

  return edition === 'ee' || edition === 'enterprise' || publicEdition === 'enterprise';
}

export function getVisibleMicrosoftConsumerTypes(
  isEnterpriseEdition = isMicrosoftConsumerEnterpriseEdition()
): MicrosoftProfileConsumer[] {
  return isEnterpriseEdition
    ? [...EE_VISIBLE_MICROSOFT_CONSUMERS]
    : [...CE_VISIBLE_MICROSOFT_CONSUMERS];
}

export function isVisibleMicrosoftConsumerType(
  consumerType: string,
  isEnterpriseEdition = isMicrosoftConsumerEnterpriseEdition()
): consumerType is MicrosoftProfileConsumer {
  return getVisibleMicrosoftConsumerTypes(isEnterpriseEdition).includes(
    consumerType as MicrosoftProfileConsumer
  );
}
