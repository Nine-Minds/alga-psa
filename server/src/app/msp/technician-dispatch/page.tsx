import React from 'react';
import TechnicianDispatchDashboard from '@alga-psa/scheduling/components/technician-dispatch/TechnicianDispatchDashboard';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Technician Dispatch',
};

export default function TechnicianDispatchPage() {
  return (
    <div className="h-screen w-full">
      <TechnicianDispatchDashboard />
    </div>
  );
}
