'use client';

import { resolveTelephonyAvailability } from '../../../../lib/telephonyAvailabilityCore';
import { TelephonyIntegrationSettings } from './TelephonyIntegrationSettings';
import { TelephonyUnavailableCard } from './TelephonyUnavailableCard';

export function TelephonyEnterpriseIntegrationSettings() {
  const availability = resolveTelephonyAvailability({
    isEnterpriseEdition: process.env.NEXT_PUBLIC_EDITION === 'enterprise',
    requireTenantContext: false,
  });

  if (!availability.enabled) {
    return <TelephonyUnavailableCard reason={availability.reason} message={availability.message} />;
  }

  return <TelephonyIntegrationSettings />;
}

export default TelephonyEnterpriseIntegrationSettings;
