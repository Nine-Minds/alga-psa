'use client';

import { resolveTelephonyAvailability } from '../../../../lib/telephonyAvailabilityCore';
import { TelephonyIntegrationSettings } from './TelephonyIntegrationSettings';
import { TelephonyPaywallCard } from './TelephonyPaywallCard';

export function TelephonyEnterpriseIntegrationSettings() {
  const availability = resolveTelephonyAvailability({
    isEnterpriseEdition: process.env.NEXT_PUBLIC_EDITION === 'enterprise',
    requireTenantContext: false,
  });

  if (!availability.enabled) {
    return <TelephonyPaywallCard reason={availability.reason} message={availability.message} />;
  }

  return <TelephonyIntegrationSettings />;
}

export default TelephonyEnterpriseIntegrationSettings;
