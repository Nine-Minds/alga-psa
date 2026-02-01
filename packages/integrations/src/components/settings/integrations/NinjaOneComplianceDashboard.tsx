'use client';

/**
 * NinjaOne Compliance Dashboard Wrapper
 *
 * Dynamically loads the EE component if available, otherwise renders nothing (CE stub).
 */

import dynamic from 'next/dynamic';

const NinjaOneComplianceDashboard = dynamic(
  () => import('@enterprise/components/settings/integrations/NinjaOneComplianceDashboard'),
  {
    loading: () => null,
    ssr: false,
  }
);

export default NinjaOneComplianceDashboard;
