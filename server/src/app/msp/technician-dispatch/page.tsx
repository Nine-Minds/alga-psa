import React from 'react';
import TechnicianDispatchDashboard from '@alga-psa/scheduling/components/technician-dispatch/TechnicianDispatchDashboard';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.technicianDispatch.title', { defaultValue: 'Technician Dispatch' }),
  };
}

export default function TechnicianDispatchPage() {
  return (
    <div className="h-screen w-full">
      <TechnicianDispatchDashboard />
    </div>
  );
}
