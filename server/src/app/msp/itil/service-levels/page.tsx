'use client';

import React from 'react';
import { SLADashboard } from '../../../../components/service-level-management/SLADashboard';

export default function ServiceLevelsPage() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <SLADashboard />
    </div>
  );
}