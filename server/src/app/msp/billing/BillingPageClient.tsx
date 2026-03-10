'use client';

import React from 'react';
import { MspBillingDashboardClient } from '@alga-psa/msp-composition/billing';

export default function BillingPageClient(props: React.ComponentProps<typeof MspBillingDashboardClient>) {
  return <MspBillingDashboardClient {...props} />;
}
